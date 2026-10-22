"""The table of aircraft types tar1090 serves, read for the feeds' kinds of aircraft that transmit no category."""

from __future__ import annotations

import logging
from typing import Any

import aiohttp
import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.adsb_live.coordinator import FeedCoordinator

from .conftest import RECEIVER, RECEIVER_URL, receiver_entry, stats
from .test_details import aircraft_with

INDEX = '<html><script>databaseFolder = "db-3.14.1722";</script></html>'
TABLE = {"A320": ["AIRBUS A-320", "L2J", "M"], "C172": ["CESSNA 172 Skyhawk", "L1P", "L"]}


async def set_up(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, index: dict[str, Any], url: str = RECEIVER_URL
) -> FeedCoordinator:
    """The receiver with its airliner transmitting no category, and tar1090's page answering with `index`."""
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{RECEIVER_URL}/", **index)
    aioclient_mock.get(f"{RECEIVER_URL}/db-3.14.1722/icao_aircraft_types2.js", json=TABLE)
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", json=aircraft_with(**{"46a1b2": {"category": "A0"}}))
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())
    entry = receiver_entry(hass, url=url)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return next(iter(entry.runtime_data.feeds.values()))


def kind_of(coordinator: FeedCoordinator, hex_code: str) -> str:
    return next(feature["properties"]["kind"] for feature in coordinator.data.features if feature["id"] == f"aircraft:{hex_code}")


def index_calls(aioclient_mock: AiohttpClientMocker) -> int:
    return sum(1 for call in aioclient_mock.mock_calls if str(call[1]) == f"{RECEIVER_URL}/")


async def test_an_aircraft_without_a_category_gets_its_types_kind(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    coordinator = await set_up(hass, aioclient_mock, {"text": INDEX})
    assert kind_of(coordinator, "46a1b2") == "air.large"
    # One with a category keeps it.
    assert kind_of(coordinator, "461f00") == "air.light"


async def test_without_tar1090_the_kind_stays_other_and_the_page_is_asked_for_again_only_an_hour_later(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000.0]
    monkeypatch.setattr("custom_components.adsb_live.coordinator.monotonic", lambda: clock[0])
    coordinator = await set_up(hass, aioclient_mock, {"status": 404})
    assert kind_of(coordinator, "46a1b2") == "air.other"
    assert index_calls(aioclient_mock) == 1
    clock[0] += 59 * 60
    await coordinator.async_refresh()
    assert index_calls(aioclient_mock) == 1
    clock[0] += 2 * 60
    await coordinator.async_refresh()
    assert index_calls(aioclient_mock) == 2


async def test_the_table_is_read_again_a_day_later(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000.0]
    monkeypatch.setattr("custom_components.adsb_live.coordinator.monotonic", lambda: clock[0])
    coordinator = await set_up(hass, aioclient_mock, {"text": INDEX})
    clock[0] += 23 * 3600
    await coordinator.async_refresh()
    assert index_calls(aioclient_mock) == 1
    clock[0] += 2 * 3600
    await coordinator.async_refresh()
    assert index_calls(aioclient_mock) == 2
    assert kind_of(coordinator, "46a1b2") == "air.large"


async def test_a_page_that_fails_behind_a_login_is_only_a_debug_line_without_the_password(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, logger="custom_components.adsb_live")
    url = RECEIVER_URL.replace("http://", "http://matti:salasana1@")
    coordinator = await set_up(hass, aioclient_mock, {"exc": aiohttp.ClientConnectionError("cannot connect to " + url)}, url=url)
    assert kind_of(coordinator, "46a1b2") == "air.other"
    assert "No table of aircraft types" in caplog.text
    assert "salasana1" not in caplog.text
    louder = [
        record for record in caplog.records if record.name.startswith("custom_components.adsb_live") and record.levelno > logging.DEBUG
    ]
    assert louder == []


async def test_a_page_without_the_tables_folder_leaves_the_kind_other(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    coordinator = await set_up(hass, aioclient_mock, {"text": "<html>tar1090 of another kind</html>"})
    assert kind_of(coordinator, "46a1b2") == "air.other"
