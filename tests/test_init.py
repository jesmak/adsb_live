"""Setting up a receiver, its health sensors and feeds, and what happens when a source fails."""

from __future__ import annotations

import asyncio
import logging
import time
from types import MappingProxyType
from typing import Any

import aiohttp
import pytest
from homeassistant.config_entries import SOURCE_RECONFIGURE, ConfigEntryState, ConfigSubentry, ConfigSubentryData
from homeassistant.const import MATCH_ALL, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker, AiohttpClientMockResponse

from custom_components.adsb_live.api import ADSB_FI_API, AdsbFiClient, RequestSpacing
from custom_components.adsb_live.colors import UNKNOWN_COLOR
from custom_components.adsb_live.const import DOMAIN
from custom_components.adsb_live.sensor import MapFeedSensor

from .conftest import (
    ADSB_FI_URL,
    AREA,
    RECEIVER,
    RECEIVER_URL,
    TEST_SPACING_SECONDS,
    adsb_fi_aircraft,
    local_aircraft,
    receiver_entry,
    stats,
    suggested_values,
)

# Airborne, with a position but no altitude of any kind.
NO_ALTITUDE = {"hex": "467000", "type": "mode_s", "category": "A3", "lat": 61.52, "lon": 23.8, "seen_pos": 2}


def mock_receiver(aioclient_mock: AiohttpClientMocker, url: str = RECEIVER_URL, aircraft: dict[str, Any] | None = None) -> None:
    aioclient_mock.get(f"{url}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{url}/data/aircraft.json", json=aircraft or local_aircraft())
    aioclient_mock.get(f"{url}/data/stats.json", json=stats())


@pytest.mark.parametrize("change", ["data", "subentry"])
async def test_a_change_saved_while_setting_up_is_applied(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    entry = receiver_entry(hass)
    [feed] = entry.subentries.values()
    added = ConfigSubentry(data=MappingProxyType(dict(feed.data)), subentry_type="feed", title=f"{feed.title} 2", unique_id=None)
    forward = hass.config_entries.async_forward_entry_setups
    setups = []

    async def save_while_setting_up(entry: MockConfigEntry, platforms) -> None:
        # Saved as a flow would save it, before setup has added its update listener.
        if not setups:
            if change == "data":
                hass.config_entries.async_update_entry(entry, data={**entry.data, "language": "fi"})
            else:
                hass.config_entries.async_add_subentry(entry, added)
        setups.append(entry.runtime_data)
        await forward(entry, platforms)

    monkeypatch.setattr(hass.config_entries, "async_forward_entry_setups", save_while_setting_up)
    # Not asserted: the reload may already be under way when the setup returns.
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert len(setups) == 2, "set up again with the change"
    if change == "data":
        assert entry.runtime_data.texts.number(2.5, 1) == "2,5"
    else:
        assert added.subentry_id in entry.runtime_data.feeds


async def test_a_receiver_gets_its_health_sensors(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get("sensor.ads_b_aircraft_with_a_position").state == "3"
    messages = hass.states.get("sensor.ads_b_messages_per_second")
    assert messages.state == "25.1"
    assert messages.attributes["unit_of_measurement"] == "msg/s"
    assert hass.states.get("sensor.ads_b_positions_per_minute").state == "48"
    assert hass.states.get("sensor.ads_b_longest_range").state == "187.7"
    assert hass.states.get("sensor.ads_b_signal").state == "-21.4"
    assert hass.states.get("sensor.ads_b_noise").state == "-38.2"


async def test_a_feed_has_the_receivers_aircraft_in_its_area(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    feed = hass.states.get("sensor.aircraft_near_tampere")
    assert feed.state == "3"
    assert feed.attributes["map_feed_version"] == 1
    assert feed.attributes["feed_type"] == "air"
    assert feed.attributes["area"] == {"center": [61.4978, 23.761], "radius_km": 100.0}
    assert "attribution" not in feed.attributes, "the receiver's own data needs no credit"
    assert "attribution_url" not in feed.attributes
    assert feed.attributes["list"]["default"] == "distance"
    ids = [feature["id"] for feature in feed.attributes["geojson"]["features"]]
    assert ids == ["aircraft:461f00", "aircraft:46a1b2", "aircraft:462000"], "one position each, so no trails yet"
    assert not any(ADSB_FI_URL in str(call[1]) for call in receiver_api.mock_calls), "adsb.fi isn't asked when the feed has it off"


def test_only_the_count_is_recorded() -> None:
    assert MapFeedSensor._unrecorded_attributes == frozenset({MATCH_ALL})


async def test_adsb_fi_adds_what_the_receiver_doesnt_hear(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass, adsb_fi=True)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    feed = hass.states.get("sensor.aircraft_near_tampere")
    assert feed.state == "4"
    assert feed.attributes["attribution"] == "adsb.fi"
    assert feed.attributes["attribution_url"] == "https://adsb.fi/", "adsb.fi's terms ask for a link"
    features = {feature["id"]: feature for feature in feed.attributes["geojson"]["features"]}
    assert features["aircraft:4ca123"]["properties"]["kind"] == "air.heavy"
    sources = {row["value"] for row in features["aircraft:46a1b2"]["properties"]["details"] if row["label"] == "Source"}
    assert sources == {"ADS-B"}, "the receiver's own position wins"


def adsb_fi_log(caplog: pytest.LogCaptureFixture) -> list[tuple[str, str]]:
    return [(record.levelname, record.getMessage()) for record in caplog.records if "adsb.fi" in record.getMessage()]


def failed(feed: str) -> str:
    return f"Fetching aircraft from adsb.fi for {feed} failed, showing the receiver's own: HTTP 429 from adsb.fi"


def works_again(feed: str) -> str:
    return f"Fetching aircraft from adsb.fi for {feed} works again"


async def test_a_failing_adsb_fi_leaves_the_receivers_aircraft_and_each_feed_logs_it_once(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    """Each feed warns when its queries start failing, logs at debug after that, and at info when they work again."""
    mock_receiver(aioclient_mock)
    aioclient_mock.get(ADSB_FI_URL, status=429)
    entry = receiver_entry(hass, adsb_fi=True, feeds=2)
    caplog.set_level(logging.DEBUG, logger="custom_components.adsb_live")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    feed = hass.states.get("sensor.aircraft_near_tampere")
    assert feed.state == "3"
    assert [feature["id"] for feature in feed.attributes["geojson"]["features"]] == [
        "aircraft:461f00",
        "aircraft:46a1b2",
        "aircraft:462000",
    ]
    assert feed.attributes["attribution"] == "adsb.fi", "a feed with adsb.fi credits it even while adsb.fi is down"
    assert hass.states.get("sensor.aircraft_near_tampere_2").state == "3", "the other feed shows the receiver's own too"

    first, second = entry.runtime_data.feeds.values()
    await first.async_refresh()
    aioclient_mock.clear_requests()
    mock_receiver(aioclient_mock)
    aioclient_mock.get(ADSB_FI_URL, json=adsb_fi_aircraft())
    await first.async_refresh()
    assert adsb_fi_log(caplog)[-1] == ("INFO", works_again("Aircraft near Tampere")), "only the first feed's queries work yet"
    await second.async_refresh()
    await hass.async_block_till_done()

    assert adsb_fi_log(caplog) == [
        ("WARNING", failed("Aircraft near Tampere")),
        ("WARNING", failed("Aircraft near Tampere 2")),
        ("DEBUG", failed("Aircraft near Tampere")),
        ("INFO", works_again("Aircraft near Tampere")),
        ("INFO", works_again("Aircraft near Tampere 2")),
    ], "the URL, with the area's centre, isn't logged"
    assert hass.states.get("sensor.aircraft_near_tampere").state == "4"
    assert hass.states.get("sensor.aircraft_near_tampere_2").state == "4"


async def test_after_a_reload_a_feed_logs_its_outage_afresh(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    """Changing a feed reloads the entry and makes new feeds, which say again that adsb.fi fails, and when it works."""
    mock_receiver(aioclient_mock)
    aioclient_mock.get(ADSB_FI_URL, status=429)
    entry = receiver_entry(hass, adsb_fi=True)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    subentry = next(iter(entry.subentries.values()))
    assert hass.config_entries.async_update_subentry(entry, subentry, data={**subentry.data, "trail_minutes": 10})
    await hass.async_block_till_done()

    coordinator = next(iter(entry.runtime_data.feeds.values()))
    aioclient_mock.clear_requests()
    mock_receiver(aioclient_mock)
    aioclient_mock.get(ADSB_FI_URL, json=adsb_fi_aircraft())
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert adsb_fi_log(caplog) == [
        ("WARNING", failed("Aircraft near Tampere")),
        ("WARNING", failed("Aircraft near Tampere")),
        ("INFO", works_again("Aircraft near Tampere")),
    ]
    assert hass.states.get("sensor.aircraft_near_tampere").state == "4"


async def test_an_adsb_fi_error_naming_its_url_doesnt_put_the_url_in_the_log(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    mock_receiver(aioclient_mock)
    # As aiohttp's connection timeout does.
    aioclient_mock.get(ADSB_FI_URL, exc=aiohttp.ClientConnectionError(f"Connection timeout to host {ADSB_FI_URL}"))
    entry = receiver_entry(hass, adsb_fi=True)
    # Debug logging is what the bug report asks for.
    caplog.set_level(logging.DEBUG, logger="custom_components.adsb_live")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert "Request to adsb.fi failed: ClientConnectionError" in caplog.text
    for part in (ADSB_FI_URL, "61.50", "23.76"):
        assert part not in caplog.text, "the area's centre stays out of the log"


async def test_a_feed_whose_queries_work_logs_nothing_about_anothers(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    """Two feeds with different areas: adsb.fi fails for one and answers the other."""
    mock_receiver(aioclient_mock)
    aioclient_mock.get(ADSB_FI_URL, status=429)
    # 70 km reaches the aircraft only adsb.fi knows, about 60 km away.
    small_area = {**AREA, "radius": 70_000}
    aioclient_mock.get(f"{ADSB_FI_API}/lat/61.50/lon/23.76/dist/39", json=adsb_fi_aircraft())
    feeds = [
        {"area": area, "adsb_fi": True, "refresh_seconds": 15, "trail_minutes": 5, "color_by_altitude": True} for area in (AREA, small_area)
    ]
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="ADS-B",
        unique_id=RECEIVER_URL,
        data={"url": RECEIVER_URL, "language": "en", "altitude_unit": "m"},
        subentries_data=[
            ConfigSubentryData(subentry_type="feed", title=f"Feed {number}", unique_id=None, data=data)
            for number, data in enumerate(feeds, start=1)
        ],
    )
    entry.add_to_hass(hass)
    caplog.set_level(logging.DEBUG, logger="custom_components.adsb_live")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    for coordinator in entry.runtime_data.feeds.values():
        await coordinator.async_refresh()

    assert adsb_fi_log(caplog) == [("WARNING", failed("Feed 1")), ("DEBUG", failed("Feed 1"))]
    assert hass.states.get("sensor.feed_1").state == "3", "the failing feed shows the receiver's own"
    assert hass.states.get("sensor.feed_2").state == "4", "the working one adds adsb.fi's"


async def test_the_feeds_of_every_receiver_take_turns_with_adsb_fi(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    """adsb.fi allows one request a second, so the feeds of every receiver wait for each other."""
    other_url = "http://other.example:8080"
    mock_receiver(aioclient_mock)
    mock_receiver(aioclient_mock, other_url)
    times: list[float] = []

    async def answer(method: str, url: object, data: object) -> AiohttpClientMockResponse:
        times.append(time.monotonic())
        return AiohttpClientMockResponse(method, url, json=adsb_fi_aircraft())

    aioclient_mock.get(ADSB_FI_URL, side_effect=answer)
    entries = [receiver_entry(hass, adsb_fi=True, feeds=2), receiver_entry(hass, adsb_fi=True, url=other_url)]
    # Setting up the first loads the integration, which sets up both.
    assert await hass.config_entries.async_setup(entries[0].entry_id)
    await hass.async_block_till_done()
    assert all(entry.state is ConfigEntryState.LOADED for entry in entries)

    # Two feeds share a name, so which one gets which entity id depends on the order they're set up in. A feed's map
    # feed sensor has the feed's id as its own.
    feeds = [
        registry_entry.entity_id
        for entry in entries
        for registry_entry in er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id)
        if registry_entry.unique_id == registry_entry.config_subentry_id
    ]
    assert len(feeds) == 3
    for entity_id in feeds:
        assert hass.states.get(entity_id).state == "4", entity_id
    assert len(times) == 3
    gaps = [later - earlier for earlier, later in zip(times, times[1:], strict=False)]
    assert all(gap >= TEST_SPACING_SECONDS * 0.9 for gap in gaps), f"each request waited for its turn: {gaps}"
    assert entries[0].runtime_data.adsb_fi is entries[1].runtime_data.adsb_fi


async def test_an_entry_saved_without_the_newer_settings_uses_their_defaults(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker
) -> None:
    """Metres for a receiver without an altitude unit, colours for a feed without the colour setting."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="ADS-B",
        unique_id=RECEIVER_URL,
        data={"url": RECEIVER_URL, "language": "en"},
        subentries_data=[
            ConfigSubentryData(
                subentry_type="feed",
                title="Aircraft near Tampere",
                unique_id=None,
                data={"area": AREA, "adsb_fi": False, "refresh_seconds": 15, "trail_minutes": 5},
            )
        ],
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    feed = hass.states.get("sensor.aircraft_near_tampere")
    airliner = next(feature for feature in feed.attributes["geojson"]["features"] if feature["id"] == "aircraft:46a1b2")
    assert airliner["properties"]["details"][0] == {"label": "Altitude", "value": "3,660 m"}
    assert airliner["properties"]["color"] == "#0cc35a"
    assert feed.attributes["legend"][1]["label"] == "300 m"

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    assert suggested_values(result)["altitude_unit"] == "m", "the receiver's form shows what the receiver uses"
    subentry = next(iter(entry.subentries.values()))
    result = await entry.start_subentry_reconfigure_flow(hass, subentry.subentry_id)
    assert suggested_values(result)["color_by_altitude"] is True, "the feed's form shows what the feed uses"


async def test_an_aircraft_without_an_altitude_is_explained_in_the_legend(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock, aircraft={**local_aircraft(), "aircraft": [*local_aircraft()["aircraft"], NO_ALTITUDE]})
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    feed = hass.states.get("sensor.aircraft_near_tampere")
    colors = {feature["id"]: feature["properties"].get("color") for feature in feed.attributes["geojson"]["features"]}
    assert colors["aircraft:467000"] == UNKNOWN_COLOR
    properties = next(f["properties"] for f in feed.attributes["geojson"]["features"] if f["id"] == "aircraft:467000")
    assert "Altitude" not in [row["label"] for row in properties["details"]]
    assert "list" not in properties, "no altitude to show in the list"
    assert "altitude_ft" not in properties, "so it sorts last by altitude"
    assert len(feed.attributes["legend"]) == 9
    assert feed.attributes["legend"][-1] == {"color": UNKNOWN_COLOR, "label": "Altitude unknown"}


async def test_a_feed_colours_its_aircraft_by_altitude(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    feed = hass.states.get("sensor.aircraft_near_tampere")
    labels = [item["label"] for item in feed.attributes["legend"]]
    assert labels == ["On the ground", "300 m", "1 km", "2 km", "3 km", "6 km", "9 km", "12 km"], (
        "no unknown altitude, as every aircraft has one"
    )
    colors = {feature["id"]: feature["properties"]["color"] for feature in feed.attributes["geojson"]["features"]}
    assert colors == {"aircraft:461f00": "#f19a1f", "aircraft:46a1b2": "#0cc35a", "aircraft:462000": "#4d4d4d"}


async def test_without_colours_there_is_no_legend(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass, color_by_altitude=False)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    feed = hass.states.get("sensor.aircraft_near_tampere")
    assert "legend" not in feed.attributes
    assert not any("color" in feature["properties"] for feature in feed.attributes["geojson"]["features"])


async def test_a_feed_is_unavailable_while_the_receiver_doesnt_answer(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", status=502)
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get("sensor.aircraft_near_tampere").state == STATE_UNAVAILABLE
    assert hass.states.get("sensor.ads_b_signal").state == "-21.4", "the health sensors don't depend on the feed"


async def test_setup_is_retried_while_the_receiver_is_down(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", status=503)
    entry = receiver_entry(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_RETRY


async def test_a_cancelled_wait_for_adsb_fi_leaves_the_turn_free() -> None:
    # Long enough that the second caller is surely still waiting when it is cancelled.
    spacing = RequestSpacing(1)
    async with spacing:
        pass

    async def wait_for_turn() -> None:
        async with spacing:
            await asyncio.sleep(10)

    waiting = asyncio.create_task(wait_for_turn())
    await asyncio.sleep(0.01)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting

    async with asyncio.timeout(2):
        async with spacing:
            pass


async def test_a_feed_and_the_health_sensors_are_unavailable_when_readsb_has_stopped_writing(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    """readsb leaves aircraft.json and stats.json behind when it stops: old files aren't shown as live."""
    stopped = time.time() - 600
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", json={**local_aircraft(), "now": stopped})
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json={**stats(), "now": stopped})
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get("sensor.aircraft_near_tampere").state == STATE_UNAVAILABLE
    assert hass.states.get("sensor.ads_b_messages_per_second").state == STATE_UNAVAILABLE


async def test_files_short_of_their_age_limits_still_count_as_live(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    """A clock a little off, or stats.json between two writes, isn't a stopped receiver."""
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", json={**local_aircraft(), "now": time.time() - 60})
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json={**stats(), "now": time.time() - 120})
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get("sensor.ads_b_messages_per_second").state == "25.1"
    assert hass.states.get("sensor.aircraft_near_tampere").state == "3"


async def test_an_update_under_way_when_the_entry_unloads_logs_no_error(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    """A refresh asked for outside the schedule isn't cancelled by an unload, and finishes quietly after it."""
    unload_during_request = False

    async def aircraft(method: str, url: object, data: object) -> AiohttpClientMockResponse:
        nonlocal unload_during_request
        if unload_during_request:
            unload_during_request = False
            await hass.config_entries.async_unload(entry.entry_id)
        return AiohttpClientMockResponse(method, url, json=local_aircraft())

    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", side_effect=aircraft)
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())
    aioclient_mock.get(ADSB_FI_URL, json=adsb_fi_aircraft())
    entry = receiver_entry(hass, adsb_fi=True)
    assert await async_setup_component(hass, "homeassistant", {})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = next(iter(entry.runtime_data.feeds.values()))

    unload_during_request = True
    await hass.services.async_call("homeassistant", "update_entity", {"entity_id": "sensor.aircraft_near_tampere"}, blocking=True)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    assert [record.getMessage() for record in caplog.records if record.levelno >= logging.ERROR] == []
    assert coordinator.last_update_success


async def test_adsb_fi_is_never_asked_for_more_than_250_nautical_miles(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    """The form already stops at 461 km. The query keeps to adsb.fi's limit even so."""
    widest = f"{ADSB_FI_API}/lat/61.50/lon/23.76/dist/250"
    aioclient_mock.get(widest, json=adsb_fi_aircraft())
    client = AdsbFiClient(async_get_clientsession(hass), "test")
    await client.aircraft_near(61.4978, 23.761, 600)
    assert [str(call[1]) for call in aioclient_mock.mock_calls] == [widest]


async def test_a_broken_aircraft_list_from_adsb_fi_leaves_the_receivers_aircraft(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    mock_receiver(aioclient_mock)
    aioclient_mock.get(ADSB_FI_URL, json={"now": time.time() * 1000, "ac": "nothing"})
    entry = receiver_entry(hass, adsb_fi=True)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("sensor.aircraft_near_tampere").state == "3"


async def test_a_broken_aircraft_list_from_the_receiver_makes_the_feed_unavailable(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    mock_receiver(aioclient_mock, aircraft={"now": time.time(), "aircraft": {"hex": "46a1b2"}})
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("sensor.aircraft_near_tampere").state == STATE_UNAVAILABLE
    assert "Unexpected error" not in caplog.text, "an answer that isn't readsb's is an ordinary failure"
