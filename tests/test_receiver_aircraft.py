"""The receiver's own aircraft, as the action get_receiver_aircraft returns them for adsb-receiver-card's list."""

from __future__ import annotations

import asyncio
import copy
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.adsb_live.aircraft import heard_aircraft
from custom_components.adsb_live.api import AdsbError
from custom_components.adsb_live.const import DOMAIN

from .conftest import ADSB_FI_URL, RECEIVER, RECEIVER_URL, adsb_fi_aircraft, local_aircraft, receiver_entry, stats

NOW = 1792566385.0
AIRLINER = {
    "hex": "46a1b2",
    "type": "adsb_icao",
    "flight": "EXA123  ",
    "r": "OH-ZZA",
    "t": "A320",
    "alt_baro": 12000,
    "gs": 300.4,
    "rssi": -8.44,
    "category": "A3",
    "lat": 61.55,
    "lon": 23.9,
    "seen_pos": 1.2,
    "seen": 0.4,
}
HEARD = {
    "hex": "46a1b2",
    "name": "EXA123",
    "registration": "OH-ZZA",
    "type": "A320",
    "altitude": 3658,
    "speed_kmh": 556,
    "rssi": -8.4,
    "heard": "2026-10-21T07:06:24+00:00",
    "position": True,
}
# The item with the fields given changed, and those given as None left out.
MISSING = None


def changed(base: dict[str, Any], **fields: Any) -> dict[str, Any]:
    result = {**base, **fields}
    return {key: value for key, value in result.items() if value is not MISSING}


# Every aircraft readsb has heard in the last minute is in the list, whether or not it has a position, except one with no
# address and what transmits a category of set C, on the ground or in the air. Its name, altitude and speed are as the map writes them:
# the callsign or else the registration or address, the barometric altitude or else the geometric one in the receiver's
# unit, and the ground speed in km/h only.
@pytest.mark.parametrize(
    ("case", "item", "unit", "expected"),
    [
        ("an airliner with everything", AIRLINER, "m", HEARD),
        ("the altitude in feet", AIRLINER, "ft", changed(HEARD, altitude=12000)),
        ("no callsign", changed(AIRLINER, flight=MISSING), "m", changed(HEARD, name="OH-ZZA")),
        (
            "no callsign or registration",
            changed(AIRLINER, hex="4ca8e2", flight=MISSING, r=MISSING),
            "m",
            changed(HEARD, hex="4ca8e2", name="4CA8E2", registration=MISSING),
        ),
        ("a blank callsign", changed(AIRLINER, flight="        "), "m", changed(HEARD, name="OH-ZZA")),
        ("on the ground", changed(AIRLINER, alt_baro="ground"), "m", changed(HEARD, altitude=MISSING, on_ground=True)),
        (
            "on the ground with a geometric altitude still",
            changed(AIRLINER, alt_baro="ground", alt_geom=350),
            "m",
            changed(HEARD, altitude=MISSING, on_ground=True),
        ),
        ("only a geometric altitude", changed(AIRLINER, alt_baro=MISSING, alt_geom=31000), "m", changed(HEARD, altitude=9449)),
        ("no altitude", changed(AIRLINER, alt_baro=MISSING), "m", changed(HEARD, altitude=MISSING)),
        ("an airspeed but no ground speed", changed(AIRLINER, gs=MISSING, ias=289), "m", changed(HEARD, speed_kmh=MISSING)),
        ("a speed that isn't a number", changed(AIRLINER, gs="fast"), "m", changed(HEARD, speed_kmh=MISSING)),
        ("no signal", changed(AIRLINER, rssi=MISSING), "m", changed(HEARD, rssi=MISSING)),
        ("a position too old to be live", changed(AIRLINER, seen_pos=120), "m", changed(HEARD, position=False)),
        ("no position", changed(AIRLINER, lat=MISSING, lon=MISSING, seen_pos=MISSING), "m", changed(HEARD, position=False)),
        ("heard a minute ago", changed(AIRLINER, seen=60), "m", changed(HEARD, heard="2026-10-21T07:05:25+00:00")),
        ("heard over a minute ago", changed(AIRLINER, seen=60.1), "m", None),
        ("no time heard", changed(AIRLINER, seen=MISSING), "m", None),
        ("a vehicle on the airport", changed(AIRLINER, alt_baro="ground", category="C1"), "m", None),
        ("a balloon on its tether", changed(AIRLINER, alt_baro=400, category="C3"), "m", None),
        ("no subcategory of set C", changed(AIRLINER, category="C0"), "m", None),
        ("no address", changed(AIRLINER, hex=MISSING), "m", None),
    ],
)
def test_heard_aircraft(case: str, item: dict[str, Any], unit: str, expected: dict[str, Any] | None) -> None:
    assert heard_aircraft({"now": NOW, "aircraft": [item]}, unit) == ([expected] if expected else [])


def test_heard_aircraft_refuses_a_list_without_its_time() -> None:
    with pytest.raises(ValueError):
        heard_aircraft({"aircraft": [AIRLINER]}, "m")


async def set_up(
    hass: HomeAssistant,
    aioclient_mock: AiohttpClientMocker,
    aircraft: dict[str, Any] | None = None,
    adsb_fi: bool = False,
    unit: str = "m",
) -> str:
    """The receiver set up, with its altitudes in `unit` and its feed using adsb.fi or not, and its device's ID."""
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", json=aircraft or local_aircraft())
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())
    aioclient_mock.get(ADSB_FI_URL, json=adsb_fi_aircraft())
    entry = receiver_entry(hass, adsb_fi=adsb_fi)
    hass.config_entries.async_update_entry(entry, data={**entry.data, "altitude_unit": unit})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, entry.entry_id), entry.entry_id)
    assert device is not None
    return device.id


async def receiver_aircraft(hass: HomeAssistant, device: str) -> dict[str, Any]:
    response = await hass.services.async_call(DOMAIN, "get_receiver_aircraft", {"device": device}, blocking=True, return_response=True)
    assert isinstance(response, dict)
    return response


def aircraft_json_calls(aioclient_mock: AiohttpClientMocker) -> int:
    return sum(1 for call in aioclient_mock.mock_calls if str(call[1]).endswith("/data/aircraft.json"))


# The receiver's own aircraft in the receiver's unit, whatever its feeds take from adsb.fi.
@pytest.mark.parametrize(
    ("adsb_fi", "unit", "altitude"), [(False, "m", 3658), (True, "m", 3658), (False, "ft", 12000), (True, "ft", 12000)]
)
async def test_answers_with_the_receivers_own_aircraft_and_its_unit(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, adsb_fi: bool, unit: str, altitude: int
) -> None:
    device = await set_up(hass, aioclient_mock, adsb_fi=adsb_fi, unit=unit)
    response = await receiver_aircraft(hass, device)
    # Of the receiver's samples, only the airliner and the aircraft without a position say when they were heard. adsb.fi's
    # heavy jet, heard just as lately, is never among them.
    assert [plane["name"] for plane in response["aircraft"]] == ["EXA123", "464000"]
    assert response["aircraft"][0]["altitude"] == altitude
    assert response["aircraft"][1]["position"] is False
    assert response["altitude_unit"] == unit


async def test_a_feeds_device_or_an_unknown_one_is_no_receiver(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    await set_up(hass, aioclient_mock)
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
    feed = next(device for device in devices if device.entry_type is dr.DeviceEntryType.SERVICE)
    for device in (feed.id, "nothing0001"):
        with pytest.raises(ServiceValidationError) as raised:
            await receiver_aircraft(hass, device)
        assert raised.value.translation_key == "unknown_receiver"


async def test_a_receiver_that_isnt_running_is_no_receiver(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    device = await set_up(hass, aioclient_mock)
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert await hass.config_entries.async_unload(entry.entry_id)
    with pytest.raises(ServiceValidationError) as raised:
        await receiver_aircraft(hass, device)
    assert raised.value.translation_key == "unknown_receiver"


async def test_answers_are_kept_for_a_few_seconds(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = await set_up(hass, aioclient_mock)
    clock = [1000.0]
    monkeypatch.setattr("custom_components.adsb_live.coordinator.monotonic", lambda: clock[0])
    before = aircraft_json_calls(aioclient_mock)
    await receiver_aircraft(hass, device)
    clock[0] += 4.9
    await receiver_aircraft(hass, device)
    assert aircraft_json_calls(aioclient_mock) == before + 1
    clock[0] += 0.2
    await receiver_aircraft(hass, device)
    assert aircraft_json_calls(aioclient_mock) == before + 2


async def test_calls_side_by_side_read_the_receiver_once(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    device = await set_up(hass, aioclient_mock)
    heard = hass.config_entries.async_entries(DOMAIN)[0].runtime_data.heard
    reads = []

    async def slow_read(url: str) -> dict[str, Any]:
        reads.append(url)
        # A read that takes a while, so that the second call arrives while the first is still reading.
        await asyncio.sleep(0.01)
        return local_aircraft()

    heard._client.aircraft = slow_read  # type: ignore[method-assign]
    first, second = await asyncio.gather(receiver_aircraft(hass, device), receiver_aircraft(hass, device))
    assert first == second
    assert len(reads) == 1


async def test_a_slow_read_counts_its_seconds_from_its_answer(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = await set_up(hass, aioclient_mock)
    heard = hass.config_entries.async_entries(DOMAIN)[0].runtime_data.heard
    clock = [1000.0]
    monkeypatch.setattr("custom_components.adsb_live.coordinator.monotonic", lambda: clock[0])
    reads = []

    async def read_taking_six_seconds(url: str) -> dict[str, Any]:
        reads.append(url)
        await asyncio.sleep(0.01)
        clock[0] += 6
        return local_aircraft()

    heard._client.aircraft = read_taking_six_seconds  # type: ignore[method-assign]
    # The second call waits for the first's answer and gets it, though the read took longer than the answer is kept.
    await asyncio.gather(receiver_aircraft(hass, device), receiver_aircraft(hass, device))
    assert len(reads) == 1


async def test_a_failure_isnt_kept(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    device = await set_up(hass, aioclient_mock)
    heard = hass.config_entries.async_entries(DOMAIN)[0].runtime_data.heard
    answers: list[Any] = [None, local_aircraft()]

    async def failing_then_answering(url: str) -> dict[str, Any]:
        answer = answers.pop(0)
        if answer is None:
            raise AdsbError("The receiver couldn't be reached")
        return answer

    heard._client.aircraft = failing_then_answering  # type: ignore[method-assign]
    with pytest.raises(HomeAssistantError):
        await receiver_aircraft(hass, device)
    # Right after the failure, well within the 5 seconds an answer is kept, the receiver is read again.
    assert [plane["name"] for plane in (await receiver_aircraft(hass, device))["aircraft"]] == ["EXA123", "464000"]
    assert answers == []


async def test_a_failure_after_an_answer_has_gone_stale_reads_again(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = await set_up(hass, aioclient_mock)
    heard = hass.config_entries.async_entries(DOMAIN)[0].runtime_data.heard
    clock = [1000.0]
    monkeypatch.setattr("custom_components.adsb_live.coordinator.monotonic", lambda: clock[0])
    answers: list[Any] = [local_aircraft(), None, local_aircraft()]

    async def answering_failing_answering(url: str) -> dict[str, Any]:
        answer = answers.pop(0)
        if answer is None:
            raise AdsbError("The receiver couldn't be reached")
        return answer

    heard._client.aircraft = answering_failing_answering  # type: ignore[method-assign]
    await receiver_aircraft(hass, device)
    clock[0] += 6
    with pytest.raises(HomeAssistantError):
        await receiver_aircraft(hass, device)
    # The failed read leaves the old answer as stale as it was, so the next call reads again rather than getting it.
    await receiver_aircraft(hass, device)
    assert answers == []


async def test_a_receiver_that_fails_or_has_stopped_answers_with_an_error(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch
) -> None:
    device = await set_up(hass, aioclient_mock)
    monkeypatch.setattr("custom_components.adsb_live.coordinator.HEARD_CACHE_SECONDS", 0)
    stopped = copy.deepcopy(local_aircraft())
    stopped["now"] -= 600
    for answer in ({"status": 500}, {"json": stopped}, {"json": {"aircraft": []}}):
        aioclient_mock.clear_requests()
        aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", **answer)
        with pytest.raises(HomeAssistantError) as raised:
            await receiver_aircraft(hass, device)
        assert raised.value.translation_key == "receiver_aircraft_failed"
