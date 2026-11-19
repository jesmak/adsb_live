"""Other feeders: reading each kind's status, their devices and sensors, and adding and changing them."""

from __future__ import annotations

import time
from typing import Any

import aiohttp
import pytest
from homeassistant.config_entries import SOURCE_RECONFIGURE, SOURCE_USER, ConfigSubentryData
from homeassistant.const import STATE_OFF, STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.update_coordinator import UpdateFailed
from pytest_homeassistant.common import MockConfigEntry
from pytest_homeassistant.test_util.aiohttp import AiohttpClientMocker

from custom_components.adsb_live.const import DOMAIN
from custom_components.adsb_live.feeders import (
    ADSB_FI_MYIP,
    ADSB_LOL_ME,
    FeederStatus,
    adsb_fi_status,
    adsb_lol_status,
    flightaware_status,
    flightradar24_status,
)

from .conftest import receiver_entry

FR24_URL = "http://feeder.example:8754"
PIAWARE_URL = "http://piaware.example:8080"


def fr24(**changes: Any) -> dict[str, Any]:
    """fr24feed's monitor.json, its numbers as text as fr24feed writes them, with a made-up key that is never read."""
    return {"feed_status": "connected", "feed_num_ac_tracked": "7", "feed_alias": "T-EXAM1", "fr24key": "0123456789abcdef", **changes}


def piaware(**changes: Any) -> dict[str, Any]:
    """piaware's status.json, written just now."""
    return {
        "time": time.time() * 1000,
        "interval": 5000,
        "adept": {"status": "green", "message": "Connected to FlightAware and logged in"},
        "mlat": {"status": "amber", "message": "No clock synchronization with nearby receivers"},
        "radio": {"status": "green", "message": "Received Mode S data recently"},
        **changes,
    }


def adsb_fi(peers: str = "3") -> dict[str, Any]:
    return {
        "beast": [{"bandwidth": "0.45", "connTime": "5163", "messageRate": "2.3", "positions": "2009"}],
        "mlat": [{"user": "EXAMPLE-1090", "privacy": True, "peerCount": peers}],
    }


def adsb_lol(peers: int = 2) -> dict[str, Any]:
    return {
        "clients": {
            "beast": [{"connected_seconds": 1051, "messages_per_second": 2.2, "uuid": "00000000-0000-..."}],
            "mlat": [{"user": "EXAMPLE-1090", "peer_count": peers, "privacy": True}],
        },
        "global": {"aircraft": 11224, "beast": 6472, "mlat": 6129},
    }


@pytest.mark.parametrize(
    ("status", "data", "expected"),
    [
        (flightradar24_status, fr24(), FeederStatus(True, 7)),
        (flightradar24_status, fr24(feed_status="connecting", feed_num_ac_tracked="0"), FeederStatus(False, 0)),
        (flightaware_status, piaware(), FeederStatus(True, "not_synchronized")),
        (flightaware_status, piaware(mlat={"status": "green"}), FeederStatus(True, "synchronized")),
        (
            flightaware_status,
            piaware(adept={"status": "amber", "message": "Connected to FlightAware, but not logged in"}, mlat={"status": "red"}),
            FeederStatus(False, "off"),
        ),
        # Without Mode S, piaware writes no MLAT status.
        (flightaware_status, {k: v for k, v in piaware().items() if k != "mlat"}, FeederStatus(True, None)),
        (adsb_fi_status, adsb_fi(), FeederStatus(True, 3)),
        (adsb_fi_status, {"beast": [], "mlat": []}, FeederStatus(False, None)),
        (adsb_lol_status, adsb_lol(), FeederStatus(True, 2)),
        (adsb_lol_status, {"clients": {"beast": [], "mlat": []}}, FeederStatus(False, None)),
    ],
)
def test_each_kind_reads_its_connection_and_detail(status: Any, data: dict[str, Any], expected: FeederStatus) -> None:
    assert status(data) == expected


def test_piaware_stopped_is_not_connected_on_its_last_file() -> None:
    """The web server goes on serving the status piaware last wrote."""
    with pytest.raises(UpdateFailed, match="piaware may have stopped"):
        flightaware_status(piaware(time=(time.time() - 300) * 1000))


@pytest.mark.parametrize(
    ("status", "data"),
    [
        (flightradar24_status, {"other": 1}),
        (flightaware_status, {}),
        (adsb_fi_status, {"error": "Too many requests"}),
        (adsb_fi_status, {"beast": None, "mlat": []}),
        (adsb_lol_status, {"_motd": []}),
        (adsb_lol_status, {"clients": {"mlat": []}}),
    ],
)
def test_an_answer_of_another_shape_fails(status: Any, data: dict[str, Any]) -> None:
    """Rather than reading as disconnected, which a feeder really can be."""
    with pytest.raises(UpdateFailed, match="Unexpected answer"):
        status(data)


def feeder(kind: str, title: str, url: str | None = None) -> ConfigSubentryData:
    data: dict[str, Any] = {"kind": kind}
    if url:
        data["url"] = url
    return ConfigSubentryData(subentry_type="feeder", title=title, unique_id=None, data=data)


def with_feeders(hass: HomeAssistant, *feeders: ConfigSubentryData) -> MockConfigEntry:
    return receiver_entry(hass, feeds=0, feeders=feeders)


ALL_FEEDERS = (
    feeder("flightradar24", "Flightradar24", FR24_URL),
    feeder("flightaware", "FlightAware", PIAWARE_URL),
    feeder("adsb_fi", "adsb.fi"),
    feeder("adsb_lol", "adsb.lol"),
)


def mock_feeders(aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{FR24_URL}/monitor.json", json=fr24())
    aioclient_mock.get(f"{PIAWARE_URL}/status.json", json=piaware())
    aioclient_mock.get(ADSB_FI_MYIP, json=adsb_fi())
    aioclient_mock.get(ADSB_LOL_ME, json=adsb_lol())


async def test_each_feeder_is_a_device_under_the_receiver(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    mock_feeders(receiver_api)
    entry = with_feeders(hass, *ALL_FEEDERS)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get("binary_sensor.flightradar24_connection").state == STATE_ON
    assert hass.states.get("sensor.flightradar24_aircraft_reported").state == "7"
    assert hass.states.get("sensor.flightradar24_aircraft_reported").attributes["unit_of_measurement"] == "aircraft"
    assert hass.states.get("binary_sensor.flightaware_connection").state == STATE_ON
    assert hass.states.get("sensor.flightaware_mlat").state == "not_synchronized"
    assert hass.states.get("sensor.adsb_fi_mlat_peers").state == "3"
    assert hass.states.get("sensor.adsb_lol_mlat_peers").state == "2"

    devices = dr.async_get(hass)
    receiver = devices.async_get_device_by_identifier((DOMAIN, entry.entry_id), entry.entry_id)
    feeders = {
        subentry.title: devices.async_get_device_by_identifier((DOMAIN, subentry.subentry_id), entry.entry_id)
        for subentry in entry.subentries.values()
    }
    for device in feeders.values():
        assert device.via_device_id == receiver.id, "the receiver card finds its feeders by this"
        assert device.manufacturer != "readsb", "the receiver card's picker offers only readsb's devices"
    assert feeders["Flightradar24"].configuration_url == FR24_URL
    assert feeders["adsb.lol"].configuration_url is None


async def test_a_feeder_that_fails_is_unavailable_and_the_rest_carry_on(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    receiver_api.get(f"{FR24_URL}/monitor.json", status=500)
    receiver_api.get(ADSB_FI_MYIP, json={"beast": [], "mlat": []})
    entry = with_feeders(hass, ALL_FEEDERS[0], ALL_FEEDERS[2])
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get("binary_sensor.flightradar24_connection").state == STATE_UNAVAILABLE
    assert hass.states.get("binary_sensor.adsb_fi_connection").state == STATE_OFF
    assert hass.states.get("sensor.adsb_fi_mlat_peers").state == "unknown"


async def test_a_feeders_login_never_reaches_the_log(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    url = "http://user:secret@feeder.example:8754"
    receiver_api.get(f"{url}/monitor.json", exc=aiohttp.ClientConnectionError(f"Cannot connect to host {url}"))
    entry = with_feeders(hass, feeder("flightradar24", "Flightradar24", url))
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get("binary_sensor.flightradar24_connection").state == STATE_UNAVAILABLE
    assert "Request to Flightradar24 failed: ClientConnectionError" in caplog.text
    assert "secret" not in caplog.text
    [subentry] = entry.subentries.values()
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, subentry.subentry_id), entry.entry_id)
    assert device.configuration_url == "http://feeder.example:8754"


async def test_the_menu_offers_the_kinds_not_added(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = with_feeders(hass, ALL_FEEDERS[2])
    assert await hass.config_entries.async_setup(entry.entry_id)

    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feeder"), context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["flightradar24", "flightaware", "adsb_lol"]


async def test_every_kind_added_aborts(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    mock_feeders(receiver_api)
    entry = with_feeders(hass, *ALL_FEEDERS)
    assert await hass.config_entries.async_setup(entry.entry_id)

    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feeder"), context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "all_feeders_added"
    await hass.async_block_till_done()


async def test_a_local_feeder_is_saved_by_its_web_server(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    mock_feeders(receiver_api)
    entry = with_feeders(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)

    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feeder"), context={"source": SOURCE_USER})
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"next_step_id": "flightradar24"})
    assert result["type"] is FlowResultType.FORM
    # The file's address pasted, with the host in capitals.
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"url": " http://FEEDER.example:8754/monitor.json "})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()

    [subentry] = entry.subentries.values()
    assert subentry.title == "Flightradar24"
    assert dict(subentry.data) == {"kind": "flightradar24", "url": FR24_URL}
    assert hass.states.get("binary_sensor.flightradar24_connection").state == STATE_ON


async def test_an_address_without_the_feeder_is_refused(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    receiver_api.get(f"{PIAWARE_URL}/status.json", status=404)
    entry = with_feeders(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)

    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feeder"), context={"source": SOURCE_USER})
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"next_step_id": "flightaware"})
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"url": PIAWARE_URL})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"url": "feeder_unreachable"}


async def test_an_online_feeder_needs_only_a_confirmation(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    receiver_api.get(ADSB_LOL_ME, status=429)
    entry = with_feeders(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)

    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feeder"), context={"source": SOURCE_USER})
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"next_step_id": "adsb_lol"})
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {})
    assert result["errors"] == {"base": "service_unreachable"}, "adsb.lol's quota ran out"

    receiver_api.clear_requests()
    receiver_api.get(ADSB_LOL_ME, json=adsb_lol())
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    [subentry] = entry.subentries.values()
    assert dict(subentry.data) == {"kind": "adsb_lol"}


async def test_reconfiguring_changes_a_local_feeders_address(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    mock_feeders(receiver_api)
    new_url = "http://other.example:8754"
    receiver_api.get(f"{new_url}/monitor.json", json=fr24(feed_num_ac_tracked="2"))
    entry = with_feeders(hass, ALL_FEEDERS[0], ALL_FEEDERS[2])
    assert await hass.config_entries.async_setup(entry.entry_id)
    fr24_id, fi_id = (next(s.subentry_id for s in entry.subentries.values() if s.title == title) for title in ("Flightradar24", "adsb.fi"))

    def reconfigure(subentry_id: str) -> Any:
        context = {"source": SOURCE_RECONFIGURE, "subentry_id": subentry_id}
        return hass.config_entries.subentries.async_init((entry.entry_id, "feeder"), context=context)

    result = await reconfigure(fi_id)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_settings"

    result = await reconfigure(fr24_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"url": f"{new_url}/"})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    await hass.async_block_till_done()
    assert entry.subentries[fr24_id].data["url"] == new_url
    assert hass.states.get("sensor.flightradar24_aircraft_reported").state == "2"
