"""Shared fixtures: made-up receiver and adsb.fi answers, and a mocked HTTP API."""

from __future__ import annotations

import time
from typing import Any

import pytest
from homeassistant.config_entries import ConfigSubentryData
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.adsb_live.api import ADSB_FI_API, without_login
from custom_components.adsb_live.const import DOMAIN

RECEIVER_URL = "http://receiver.example:8080"
# Tampere: the receiver and the made-up aircraft are around it.
RECEIVER_POSITION = (61.4978, 23.761)
AREA = {"latitude": RECEIVER_POSITION[0], "longitude": RECEIVER_POSITION[1], "radius": 100_000}
# The query adsb.fi gets for AREA: the centre rounded to about a kilometre, and 100 km is 54 nautical miles rounded up,
# plus one to make up for the rounding.
ADSB_FI_URL = f"{ADSB_FI_API}/lat/61.50/lon/23.76/dist/55"
# Requests to adsb.fi are kept this far apart in the tests, so that waiting for one's turn shows without slowing them.
TEST_SPACING_SECONDS = 0.05


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Lets Home Assistant load integrations from custom_components/."""


@pytest.fixture(autouse=True)
def short_adsb_fi_spacing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("custom_components.adsb_live.api.ADSB_FI_SPACING_SECONDS", TEST_SPACING_SECONDS)


RECEIVER = {
    "refresh": 1000,
    "history": 120,
    "lat": RECEIVER_POSITION[0],
    "lon": RECEIVER_POSITION[1],
    "version": "3.16.17 wiedehopf git: v3.16.17",
}


def local_aircraft() -> dict[str, Any]:
    """An airliner descending, a light aircraft heard by MLAT and one on the ground, and four that are left out."""
    return {
        "now": time.time(),
        "messages": 123456,
        "aircraft": [
            {
                "hex": "46a1b2",
                "type": "adsb_icao",
                "flight": "EXA123  ",
                "r": "OH-ZZA",
                "t": "A320",
                "desc": "AIRBUS A-320",
                "ownOp": "Example Air",
                "alt_baro": 12000,
                "gs": 300.4,
                "track": 90.3,
                "baro_rate": -1024,
                "squawk": "4521",
                "category": "A3",
                "lat": 61.55,
                "lon": 23.9,
                "seen_pos": 1.2,
                "seen": 0.4,
            },
            {
                "hex": "461f00",
                "type": "mlat",
                "r": "OH-ZZB",
                "t": "C172",
                "alt_baro": 2500,
                "gs": 95,
                "track": 270,
                "baro_rate": 0,
                "category": "A1",
                "lat": 61.45,
                "lon": 23.7,
                "seen_pos": 3,
            },
            {
                "hex": "462000",
                "type": "adsb_icao",
                "flight": "EXA456",
                "alt_baro": "ground",
                # Taxiing aircraft report a rate too, which means nothing on the ground.
                "baro_rate": -64,
                "gs": 12,
                "track": 180,
                "category": "A3",
                "lat": 61.414,
                "lon": 23.604,
                "seen_pos": 5,
            },
            # A position too old to be live.
            {"hex": "463000", "type": "adsb_icao", "alt_baro": 30000, "category": "A3", "lat": 61.6, "lon": 23.8, "seen_pos": 120},
            # No position at all.
            {"hex": "464000", "type": "mode_s", "alt_baro": 35000, "seen": 2},
            # A vehicle on the airport, not an aircraft.
            {"hex": "465000", "type": "adsb_icao", "alt_baro": "ground", "category": "C1", "lat": 61.415, "lon": 23.605, "seen_pos": 1},
            # Outside the area.
            {"hex": "466000", "type": "adsb_icao", "alt_baro": 37000, "category": "A3", "lat": 63.0, "lon": 25.0, "seen_pos": 1},
        ],
    }


def adsb_fi_aircraft() -> dict[str, Any]:
    """The airliner the receiver also hears, and a heavy jet only adsb.fi knows."""
    now_ms = time.time() * 1000
    return {
        "ac": [
            {"hex": "46a1b2", "type": "adsb_icao", "flight": "EXA123  ", "alt_baro": 11900, "lat": 61.551, "lon": 23.91, "seen_pos": 2},
            {
                "hex": "4ca123",
                "type": "adsb_icao",
                "flight": "EXA789  ",
                "r": "EI-ZZC",
                "t": "B77W",
                "alt_baro": 36000,
                "gs": 480,
                "track": 45,
                "category": "A5",
                "lat": 61.9,
                "lon": 24.5,
                "seen_pos": 0.5,
            },
        ],
        "msg": "No error",
        "now": now_ms,
        "total": 2,
    }


def stats() -> dict[str, Any]:
    """readsb's statistics, written just now, as readsb writes them every minute."""
    return {
        "now": time.time(),
        "aircraft_with_pos": 3,
        "aircraft_without_pos": 1,
        "last1min": {
            "start": 1792566325.0,
            "end": 1792566385.0,
            "local": {"signal": -21.4, "noise": -38.2},
            "messages_valid": 1503,
            "position_count_total": 48,
        },
        "last15min": {"start": 1792565485.0, "end": 1792566385.0, "max_distance": 187654},
    }


@pytest.fixture
def receiver_api(aioclient_mock: AiohttpClientMocker) -> AiohttpClientMocker:
    """The receiver's files and adsb.fi, answering with the samples above."""
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", json=local_aircraft())
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())
    aioclient_mock.get(ADSB_FI_URL, json=adsb_fi_aircraft())
    return aioclient_mock


def suggested_values(result: Any) -> dict[str, Any]:
    """What a flow's form suggests for each field."""
    return {str(key): key.description["suggested_value"] for key in result["data_schema"].schema if key.description}


def receiver_entry(
    hass: HomeAssistant,
    adsb_fi: bool = False,
    color_by_altitude: bool = True,
    feeds: int = 1,
    url: str = RECEIVER_URL,
    feed: dict[str, Any] | None = None,
) -> MockConfigEntry:
    """A receiver with feeds around Tampere: "Aircraft near Tampere", then "Aircraft near Tampere 2" and so on.

    The feeds have the form's defaults, apart from adsb.fi and colours, unless `feed` gives all their settings.
    """
    data = feed or {
        "area": AREA,
        "adsb_fi": adsb_fi,
        "refresh_seconds": 15,
        "trail_minutes": 5,
        "color_by_altitude": color_by_altitude,
        "overhead_radius_km": 5,
        "overhead_altitude": 1500,
        "overhead_altitude_unit": "m",
    }
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="ADS-B",
        # As the config flow makes it: the address without a login.
        unique_id=without_login(url),
        data={"url": url, "language": "en", "altitude_unit": "m"},
        subentries_data=[
            ConfigSubentryData(
                subentry_type="feed",
                title="Aircraft near Tampere" + (f" {number}" if number > 1 else ""),
                unique_id=None,
                data=data,
            )
            for number in range(1, feeds + 1)
        ],
    )
    entry.add_to_hass(hass)
    return entry
