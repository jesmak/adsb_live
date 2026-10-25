"""The receiver's config flow and the feed subentry flow."""

from __future__ import annotations

import logging
from typing import Any

import aiohttp
import pytest
from homeassistant.config_entries import SOURCE_RECONFIGURE, SOURCE_USER, ConfigEntryDisabler, ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.adsb_live.api import ADSB_FI_API
from custom_components.adsb_live.const import DOMAIN

from .conftest import AREA, RECEIVER, RECEIVER_URL, adsb_fi_aircraft, local_aircraft, receiver_entry, stats, suggested_values

FEED = {
    "name": "Aircraft near Tampere",
    "area": AREA,
    "adsb_fi": False,
    "refresh_seconds": 15,
    "trail_minutes": 5,
    "color_by_altitude": True,
    "overhead_radius_km": 5,
    "overhead_altitude": 1500,
}


async def test_user_flow_creates_the_receiver(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    suggested = suggested_values(result)
    assert suggested["altitude_unit"] == "m", "metres where Home Assistant is metric"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": " ADS-B ", "url": f" {RECEIVER_URL}/data/ ", "language": "fi", "altitude_unit": "m"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "ADS-B"
    assert result["data"] == {"url": RECEIVER_URL, "language": "fi", "altitude_unit": "m"}
    assert result["result"].unique_id == RECEIVER_URL


async def test_an_address_without_a_receiver_is_refused(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", status=404)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": "ADS-B", "url": RECEIVER_URL, "language": "en", "altitude_unit": "m"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"url": "cannot_connect"}


async def test_the_same_receiver_is_set_up_only_once(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    receiver_entry(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": "Again", "url": RECEIVER_URL, "language": "en", "altitude_unit": "m"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_reconfiguring_a_loaded_receiver_reloads_it_once_with_the_new_settings(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker
) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    other_url = "http://other.example/tar1090"
    receiver_api.get(f"{other_url}/data/receiver.json", json=RECEIVER)
    # Unlike the old address's, so the feed and the statistics can only have come from the new one.
    moved = local_aircraft()
    receiver_api.get(f"{other_url}/data/aircraft.json", json={**moved, "aircraft": moved["aircraft"][:1]})
    receiver_api.get(f"{other_url}/data/stats.json", json={**stats(), "aircraft_with_pos": 1})

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": f"{other_url}/", "language": "fi", "altitude_unit": "ft"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert result.get("translation_domain") is None, "the integration's own text"
    await hass.async_block_till_done()

    assert entry.data == {"url": other_url, "language": "fi", "altitude_unit": "ft"}
    assert entry.unique_id == other_url
    assert entry.state is ConfigEntryState.LOADED
    assert hass.states.get("sensor.aircraft_near_tampere").state == "1", "the feed reads the new address"
    assert hass.states.get("sensor.ads_b_aircraft_with_a_position").state == "1", "and so do the statistics"
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, entry.entry_id), entry.entry_id)
    assert device.configuration_url == other_url
    receiver_calls = [call for call in receiver_api.mock_calls if str(call[1]) == f"{other_url}/data/receiver.json"]
    assert len(receiver_calls) == 2, "the form's check and one setup, not two"
    feed = hass.states.get("sensor.aircraft_near_tampere")
    airliner = next(feature for feature in feed.attributes["geojson"]["features"] if feature["id"] == "aircraft:46a1b2")
    assert airliner["properties"]["details"][:2] == [
        {"label": "Korkeus", "value": "12\u00a0000 ft"},
        {"label": "Pystynopeus", "value": "laskee 1\u00a0024 ft/min"},
    ], "Finnish, in feet"
    assert [item["label"] for item in feed.attributes["legend"]][:3] == ["Maassa", "1\u00a0000 ft", "3\u00a0000 ft"]
    assert [key["label"] for key in feed.attributes["list"]["sort"]] == ["Etäisyys", "Korkeus"]
    assert feed.attributes["list"]["count"] == "ilma-alusta"
    assert feed.attributes["list"]["count_one"] == "ilma-alus"


async def test_reconfiguring_a_disabled_receiver_keeps_it_unloaded(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    await hass.config_entries.async_set_disabled_by(entry.entry_id, ConfigEntryDisabler.USER)
    await hass.async_block_till_done()
    other_url = "http://other.example/tar1090"
    receiver_api.get(f"{other_url}/data/receiver.json", json=RECEIVER)

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": other_url, "language": "fi", "altitude_unit": "ft"})
    assert result["reason"] == "reconfigure_successful"
    assert result.get("translation_domain") is None, "the integration's own text"
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    assert entry.data == {"url": other_url, "language": "fi", "altitude_unit": "ft"}
    assert entry.unique_id == other_url


async def test_adding_a_feed_creates_its_sensor(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feed"), context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    suggested = suggested_values(result)
    assert suggested["area"] == {"latitude": 61.4978, "longitude": 23.761, "radius": 100_000}, "around the receiver"
    assert suggested["adsb_fi"] is False
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {**FEED, "name": "Second feed"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert hass.states.get("sensor.second_feed").state == "3"


async def test_a_feed_needs_a_radius_within_what_adsb_fi_answers(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feed"), context={"source": SOURCE_USER})
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {**FEED, "area": {**AREA, "radius": 0}})
    assert result["errors"] == {"area": "area_radius"}
    # adsb.fi answers for 250 nautical miles, one of which goes to the query's rounded centre: 461 km is the most.
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"], {**FEED, "adsb_fi": True, "area": {**AREA, "radius": 462_000}}
    )
    assert result["errors"] == {"area": "adsb_fi_radius"}
    # The widest area asks adsb.fi for its largest radius, 250 nautical miles.
    widest = f"{ADSB_FI_API}/lat/61.50/lon/23.76/dist/250"
    receiver_api.get(widest, json=adsb_fi_aircraft())
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"], {**FEED, "name": "Wide", "adsb_fi": True, "area": {**AREA, "radius": 461_000}}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert any(str(call[1]) == widest for call in receiver_api.mock_calls)
    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feed"), context={"source": SOURCE_USER})
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {**FEED, "area": {**AREA, "radius": 500_000}})
    assert result["type"] is FlowResultType.CREATE_ENTRY, "without adsb.fi, any radius goes"


async def test_reconfiguring_a_feed_shows_and_keeps_its_settings(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    # Every setting differs from the form's defaults, so the form can only be showing the feed's own.
    small_area = {**AREA, "radius": 40_000}
    feed = {
        "area": small_area,
        "adsb_fi": True,
        "refresh_seconds": 30,
        "trail_minutes": 10,
        "color_by_altitude": False,
        "overhead_radius_km": 2.5,
        "overhead_altitude": 800,
        "overhead_altitude_unit": "m",
    }
    receiver_api.get(f"{ADSB_FI_API}/lat/61.50/lon/23.76/dist/23", json=adsb_fi_aircraft())
    entry = receiver_entry(hass, feed=feed)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    subentry = next(iter(entry.subentries.values()))

    result = await entry.start_subentry_reconfigure_flow(hass, subentry.subentry_id)
    assert result["type"] is FlowResultType.FORM
    shown = {key: value for key, value in feed.items() if key != "overhead_altitude_unit"}
    assert suggested_values(result) == {"name": "Aircraft near Tampere", **shown}, "the unit isn't a field, the receiver's is used"
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {**FEED, "name": "Renamed", "trail_minutes": 20})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert result.get("translation_domain") is None, "the integration's own text"
    await hass.async_block_till_done()
    subentry = entry.subentries[subentry.subentry_id]
    assert subentry.title == "Renamed"
    assert subentry.data == {
        "area": AREA,
        "adsb_fi": False,
        "refresh_seconds": 15,
        "trail_minutes": 20,
        "color_by_altitude": True,
        "overhead_radius_km": 5,
        "overhead_altitude": 1500,
        "overhead_altitude_unit": "m",
    }
    assert type(subentry.data["refresh_seconds"]) is int, "the form's numbers are saved as whole numbers"
    assert type(subentry.data["trail_minutes"]) is int
    assert type(subentry.data["overhead_altitude"]) is int

    feed = hass.states.get("sensor.aircraft_near_tampere")
    assert "attribution" not in feed.attributes, "adsb.fi off after the change"
    assert "attribution_url" not in feed.attributes
    assert "legend" in feed.attributes, "colours on after the change"


async def test_reconfiguring_a_receiver_waiting_to_retry_loads_it_now(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    """The receiver has moved: its old address fails, and the new one is put in with Reconfigure."""
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", status=503)
    entry = receiver_entry(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_RETRY

    new_url = "http://moved.example:8080"
    aioclient_mock.get(f"{new_url}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{new_url}/data/aircraft.json", json=local_aircraft())
    aioclient_mock.get(f"{new_url}/data/stats.json", json=stats())
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": new_url, "language": "en", "altitude_unit": "m"})
    assert result["reason"] == "reconfigure_successful"
    await hass.async_block_till_done()
    receiver_calls = [call for call in aioclient_mock.mock_calls if str(call[1]) == f"{new_url}/data/receiver.json"]
    assert len(receiver_calls) == 2, "the form's check and one setup, not two"
    assert result.get("translation_domain") is None, "the integration's own text"
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED, "not left waiting for the next retry"
    assert entry.data == {"url": new_url, "language": "en", "altitude_unit": "m"}
    assert entry.unique_id == new_url
    assert hass.states.get("sensor.aircraft_near_tampere").state == "3"


@pytest.mark.parametrize("state", ["setting_up", "setup_error"])
async def test_reconfiguring_sets_the_receiver_up_once_with_the_new_settings(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch, state: str
) -> None:
    """Saved while setup still runs, its own check reloads the entry. After a setup error, the flow does."""
    entry = receiver_entry(hass)
    forward = hass.config_entries.async_forward_entry_setups
    setups = []

    async def reconfigure() -> None:
        result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"url": RECEIVER_URL, "language": "fi", "altitude_unit": "m"}
        )
        assert result["reason"] == "reconfigure_successful"

    async def count_setups(entry, platforms) -> None:
        setups.append(entry.data["language"])
        if state == "setting_up" and len(setups) == 1:
            await reconfigure()
        await forward(entry, platforms)

    monkeypatch.setattr(hass.config_entries, "async_forward_entry_setups", count_setups)
    if state == "setup_error":
        with monkeypatch.context() as broken:
            broken.setattr("custom_components.adsb_live.Receiver.from_json", lambda *args: 1 / 0)
            await hass.config_entries.async_setup(entry.entry_id)
            await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.SETUP_ERROR
        await reconfigure()
    else:
        await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert setups == (["en", "fi"] if state == "setting_up" else ["fi"]), "set up once with the new settings, not again on top"


async def test_feet_are_the_default_under_us_units(hass: HomeAssistant) -> None:
    hass.config.units = US_CUSTOMARY_SYSTEM
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    suggested = suggested_values(result)
    assert suggested["altitude_unit"] == "ft"


async def test_reconfiguring_refuses_another_receivers_address(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    receiver_entry(hass, url="http://other.example:8080")
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": "http://other.example:8080/", "language": "en", "altitude_unit": "m"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert entry.data["url"] == RECEIVER_URL, "the entry keeps its own address"


async def test_the_unit_can_be_changed_while_the_receiver_is_off(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    """Only a new address is checked: a receiver that is off doesn't stop the other settings from being saved."""
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", status=503)
    entry = receiver_entry(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_RETRY

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": f"{RECEIVER_URL}/", "language": "fi", "altitude_unit": "ft"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert result.get("translation_domain") is None, "the integration's own text"
    await hass.async_block_till_done()
    assert entry.data == {"url": RECEIVER_URL, "language": "fi", "altitude_unit": "ft"}
    assert entry.state is ConfigEntryState.SETUP_RETRY, "still waiting for the receiver"


async def test_a_loaded_receiver_that_goes_off_can_still_have_its_unit_changed(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    """The change is saved, and the reload it makes waits for the receiver like any other setup."""
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", json=local_aircraft())
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", status=503)

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": RECEIVER_URL, "language": "en", "altitude_unit": "ft"}
    )
    assert result["reason"] == "reconfigure_successful"
    await hass.async_block_till_done()

    assert entry.data == {"url": RECEIVER_URL, "language": "en", "altitude_unit": "ft"}
    assert entry.state is ConfigEntryState.SETUP_RETRY


async def test_reconfiguring_to_an_address_without_a_receiver_is_refused(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    other_url = "http://other.example/tar1090"
    receiver_api.get(f"{other_url}/data/receiver.json", status=404)
    old_address_calls = len(receiver_api.mock_calls)

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": other_url, "language": "fi", "altitude_unit": "ft"})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"url": "cannot_connect"}
    await hass.async_block_till_done()
    later = [str(call[1]) for call in receiver_api.mock_calls[old_address_calls:]]
    assert later == [f"{other_url}/data/receiver.json"], "only the form's check, no setup of the old address again"
    assert entry.data == {"url": RECEIVER_URL, "language": "en", "altitude_unit": "m"}, "nothing saved"
    assert entry.unique_id == RECEIVER_URL
    assert entry.state is ConfigEntryState.LOADED, "and not reloaded"


async def test_the_same_receiver_in_another_case_is_still_the_same(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    receiver_entry(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": "Again", "url": "HTTP://Receiver.Example:8080/data/", "language": "en", "altitude_unit": "m"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_a_receiver_behind_a_login_keeps_its_password_out_of_sight(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    """The login keeps its case, and the log, the retry's reason and the device's link don't show it."""
    url = "http://adsb:S3cret@receiver.example:8080/tar1090"
    # Debug logging is what the bug report asks for, and it prints tracebacks with their causes.
    caplog.set_level(logging.DEBUG, logger="custom_components.adsb_live")
    aioclient_mock.get(f"{url}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{url}/data/aircraft.json", json=local_aircraft())
    aioclient_mock.get(f"{url}/data/stats.json", json=stats())
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"name": "ADS-B", "url": "http://adsb:S3cret@Receiver.Example:8080/tar1090/", "language": "en", "altitude_unit": "m"},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["url"] == url, "the password's case is kept"
    assert result["result"].unique_id == "http://receiver.example:8080/tar1090", "the id has no login"
    await hass.async_block_till_done()
    entry = result["result"]

    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, entry.entry_id), entry.entry_id)
    assert device.configuration_url == "http://receiver.example:8080/tar1090"

    # A failure that aiohttp describes with the whole address, login included, while the receiver otherwise answers.
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{url}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{url}/data/aircraft.json", json=local_aircraft())
    aioclient_mock.get(f"{url}/data/stats.json", exc=aiohttp.ClientConnectionError(f"Connection timeout to host {url}"))
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("sensor.ads_b_signal").state == STATE_UNAVAILABLE
    assert "Request to http://receiver.example:8080/tar1090/data/stats.json failed: ClientConnectionError" in caplog.text

    # And a receiver that refuses the login: the reason of its retry.
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{url}/data/receiver.json", status=401)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_RETRY
    assert "HTTP 401 from http://receiver.example:8080/tar1090/data/receiver.json" in entry.reason
    assert "S3cret" not in caplog.text
    assert "S3cret" not in (entry.reason or "")


async def test_the_same_receiver_with_another_login_is_still_the_same(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    """A changed password doesn't make the receiver a new one, whether added again or reconfigured to."""
    old_login = "http://adsb:Old@receiver.example:8080"
    receiver_entry(hass, url=old_login)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": "Again", "url": "http://adsb:New@receiver.example:8080", "language": "en", "altitude_unit": "m"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"

    other = receiver_entry(hass, url="http://other.example:8080")
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": other.entry_id})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": "http://someone:Else@receiver.example:8080", "language": "en", "altitude_unit": "m"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured", "another receiver can't take this one's address with another login"


async def test_reconfiguring_to_an_address_with_a_login_saves_an_id_without_it(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker
) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    login_url = "http://adsb:S3cret@other.example:8080"
    receiver_api.get(f"{login_url}/data/receiver.json", json=RECEIVER)
    receiver_api.get(f"{login_url}/data/aircraft.json", json=local_aircraft())
    receiver_api.get(f"{login_url}/data/stats.json", json=stats())

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"url": login_url, "language": "en", "altitude_unit": "m"})
    assert result["reason"] == "reconfigure_successful"
    await hass.async_block_till_done()

    assert entry.data["url"] == login_url, "the requests need the login"
    assert entry.unique_id == "http://other.example:8080", "the id doesn't"


def altitude_field(result: Any) -> Any:
    key = next(key for key in result["data_schema"].schema if str(key) == "overhead_altitude")
    return result["data_schema"].schema[key].config


async def test_a_new_feed_takes_its_overhead_altitude_in_the_receivers_unit(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feed"), context={"source": SOURCE_USER})
    assert altitude_field(result)["unit_of_measurement"] == "m"
    assert suggested_values(result)["overhead_altitude"] == 1500

    hass.config_entries.async_update_entry(entry, data={**entry.data, "altitude_unit": "ft"})
    await hass.async_block_till_done()
    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feed"), context={"source": SOURCE_USER})
    assert altitude_field(result)["unit_of_measurement"] == "ft"
    assert suggested_values(result)["overhead_altitude"] == 5000
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {**FEED, "name": "Feet", "overhead_altitude": 2005})
    await hass.async_block_till_done()
    saved = next(subentry for subentry in entry.subentries.values() if subentry.title == "Feet")
    assert (saved.data["overhead_altitude"], saved.data["overhead_altitude_unit"]) == (2005, "ft"), "as it was entered"


async def test_after_the_receivers_unit_changes_the_form_shows_the_altitude_converted_and_saves_what_it_shows(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker
) -> None:
    entry = receiver_entry(hass)
    hass.config_entries.async_update_entry(entry, data={**entry.data, "altitude_unit": "ft"})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    subentry = next(iter(entry.subentries.values()))

    result = await entry.start_subentry_reconfigure_flow(hass, subentry.subentry_id)
    assert suggested_values(result)["overhead_altitude"] == 4920, "1 500 m in feet, to 10 ft"
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {**FEED, "overhead_altitude": 4920})
    await hass.async_block_till_done()
    saved = entry.subentries[subentry.subentry_id].data
    assert (saved["overhead_altitude"], saved["overhead_altitude_unit"]) == (4920, "ft"), "what was shown, in the unit shown"

    # Back to metres, a limit as high as the feet form takes is shown as high as the metres form takes.
    hass.config_entries.async_update_subentry(entry, subentry, data={**saved, "overhead_altitude": 33000})
    hass.config_entries.async_update_entry(entry, data={**entry.data, "altitude_unit": "m"})
    await hass.async_block_till_done()
    result = await entry.start_subentry_reconfigure_flow(hass, subentry.subentry_id)
    assert suggested_values(result)["overhead_altitude"] == 10000


async def test_a_feed_saved_without_the_overhead_settings_shows_their_defaults(
    hass: HomeAssistant, receiver_api: AiohttpClientMocker
) -> None:
    feed = {"area": AREA, "adsb_fi": False, "refresh_seconds": 15, "trail_minutes": 5, "color_by_altitude": True}
    entry = receiver_entry(hass, feed=feed)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    subentry = next(iter(entry.subentries.values()))
    result = await entry.start_subentry_reconfigure_flow(hass, subentry.subentry_id)
    assert suggested_values(result) == {"name": "Aircraft near Tampere", **feed, "overhead_radius_km": 5, "overhead_altitude": 1500}, (
        "1 500 m in a metre receiver"
    )


async def test_a_form_saves_its_altitude_in_the_unit_it_was_shown_in(hass: HomeAssistant, receiver_api: AiohttpClientMocker) -> None:
    """The receiver changed to feet while the feed's form was open in metres: 1 500 is still metres."""
    entry = receiver_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    result = await hass.config_entries.subentries.async_init((entry.entry_id, "feed"), context={"source": SOURCE_USER})
    assert altitude_field(result)["unit_of_measurement"] == "m"
    hass.config_entries.async_update_entry(entry, data={**entry.data, "altitude_unit": "ft"})
    await hass.async_block_till_done()
    result = await hass.config_entries.subentries.async_configure(result["flow_id"], {**FEED, "name": "Open in metres"})
    await hass.async_block_till_done()
    saved = next(subentry for subentry in entry.subentries.values() if subentry.title == "Open in metres")
    assert (saved.data["overhead_altitude"], saved.data["overhead_altitude_unit"]) == (1500, "m")
