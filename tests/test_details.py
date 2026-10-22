"""The details on tap (route and photo), the nearest aircraft, and the events of a feed."""

from __future__ import annotations

import copy
from datetime import timedelta
from typing import Any

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import async_mock_service
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.adsb_live.api import DETAILS_CLIENT, PLANESPOTTERS_API, ROUTES_URL
from custom_components.adsb_live.const import DOMAIN
from custom_components.adsb_live.coordinator import FeedCoordinator

from .conftest import AREA, RECEIVER, RECEIVER_URL, local_aircraft, receiver_entry, stats

FEED_ENTITY = "sensor.aircraft_near_tampere"
EVENTS_ENTITY = "event.aircraft_near_tampere_aircraft_events"
NEAREST_ENTITY = "sensor.aircraft_near_tampere_nearest_aircraft"


def airport(name: str, iata: str, latitude: float, longitude: float) -> dict[str, Any]:
    return {"name": f"{name} Airport", "icao": f"EF{iata[:2]}", "iata": iata, "location": name, "lat": latitude, "lon": longitude}


# EXA123 flies east of Tampere, near the line from Tampere to Helsinki.
ROUTE = {"callsign": "EXA123", "_airports": [airport("Tampere", "TMP", 61.414, 23.604), airport("Helsinki", "HEL", 60.317, 24.963)]}
# Hundreds of kilometres from where EXA123 is: another day's route.
FAR_ROUTE = {"callsign": "EXA123", "_airports": [airport("Oulu", "OUL", 64.93, 25.354), airport("Ivalo", "IVL", 68.607, 27.405)]}
PHOTO = {
    "photos": [
        {
            "id": "1",
            "thumbnail": {"src": "https://t.example.net/1_t.jpg", "size": {"width": 200, "height": 133}},
            "thumbnail_large": {"src": "https://t.example.net/1_280.jpg", "size": {"width": 420, "height": 280}},
            "link": "https://www.example.net/photo/1",
            "photographer": "Matti Meikäläinen",
        }
    ]
}


def aircraft_with(**changes: dict[str, Any]) -> dict[str, Any]:
    """The sample aircraft, each changed by its address's dict of fields."""
    data = copy.deepcopy(local_aircraft())
    for item in data["aircraft"]:
        item.update(changes.get(item["hex"], {}))
    return data


def mock_receiver(aioclient_mock: AiohttpClientMocker, aircraft: dict[str, Any] | None = None) -> None:
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", json=aircraft or local_aircraft())
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())


def mock_details(aioclient_mock: AiohttpClientMocker, route: dict[str, Any] | None = ROUTE, photo: dict[str, Any] = PHOTO) -> None:
    if route is None:
        aioclient_mock.get(f"{ROUTES_URL}/EX/EXA123.json", status=404)
    else:
        aioclient_mock.get(f"{ROUTES_URL}/EX/EXA123.json", json=route)
    aioclient_mock.get(f"{PLANESPOTTERS_API}/46a1b2", json=photo)


async def set_up(hass: HomeAssistant, feed: dict[str, Any] | None = None) -> tuple[str, FeedCoordinator]:
    entry = receiver_entry(hass, feed=feed)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    subentry_id = next(iter(entry.subentries))
    return subentry_id, entry.runtime_data.feeds[subentry_id]


async def details(hass: HomeAssistant, feed: str, hex_code: str) -> list[dict[str, Any]]:
    response = await hass.services.async_call(
        DOMAIN, "get_aircraft_details", {"feed": feed, "hex": hex_code}, blocking=True, return_response=True
    )
    return response["details"]


async def test_each_aircraft_names_the_detail_action_with_its_feed(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock)
    feed, _ = await set_up(hass)
    features = hass.states.get(FEED_ENTITY).attributes["geojson"]["features"]
    airliner = next(feature for feature in features if feature["id"] == "aircraft:46a1b2")
    assert airliner["properties"]["detail_action"] == {"action": "adsb_live.get_aircraft_details", "data": {"feed": feed, "hex": "46a1b2"}}


async def test_the_details_are_the_route_and_a_linked_photo_with_its_credit(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    mock_receiver(aioclient_mock)
    mock_details(aioclient_mock)
    feed, _ = await set_up(hass)
    assert await details(hass, feed, "46A1B2") == [
        {"label": "Route", "value": "Tampere (TMP) → Helsinki (HEL)"},
        {
            "label": "Photo",
            "value": "Matti Meikäläinen",
            "image": {
                "url": "https://t.example.net/1_280.jpg",
                "caption": "© Matti Meikäläinen, Planespotters.net",
                "link": "https://www.example.net/photo/1",
            },
        },
    ]
    planespotters = [call for call in aioclient_mock.mock_calls if str(call[1]).startswith(PLANESPOTTERS_API)]
    assert planespotters[0][3]["User-Agent"].startswith("adsb_live/"), "Planespotters blocks libraries' own user agents"

    calls = aioclient_mock.call_count
    await details(hass, feed, "46a1b2")
    assert aioclient_mock.call_count == calls, "both answers are cached"


async def test_a_route_far_from_the_aircraft_or_unknown_is_left_out(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock)
    mock_details(aioclient_mock, route=FAR_ROUTE, photo={"photos": []})
    feed, _ = await set_up(hass)
    assert await details(hass, feed, "46a1b2") == [], "another day's route, and no photo"

    aioclient_mock.clear_requests()
    mock_details(aioclient_mock, route=None)
    client = hass.data[DETAILS_CLIENT]
    client._routes.clear()
    client._photos.clear()
    rows = await details(hass, feed, "46a1b2")
    assert [row["label"] for row in rows] == ["Photo"], "a callsign the route data doesn't know"


async def test_answers_that_find_nothing_are_cached_too(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock)
    aioclient_mock.get(f"{ROUTES_URL}/EX/EXA123.json", status=404)
    aioclient_mock.get(f"{PLANESPOTTERS_API}/46a1b2", status=404)
    feed, _ = await set_up(hass)
    assert await details(hass, feed, "46a1b2") == []
    calls = aioclient_mock.call_count
    assert await details(hass, feed, "46a1b2") == []
    assert aioclient_mock.call_count == calls, "nothing asked again for a day"


async def test_a_failing_source_leaves_out_only_its_own_row(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock)
    aioclient_mock.get(f"{ROUTES_URL}/EX/EXA123.json", json=ROUTE)
    aioclient_mock.get(f"{PLANESPOTTERS_API}/46a1b2", status=503)
    feed, _ = await set_up(hass)
    assert [row["label"] for row in await details(hass, feed, "46a1b2")] == ["Route"]

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{ROUTES_URL}/EX/EXA123.json", json=ROUTE)
    aioclient_mock.get(f"{PLANESPOTTERS_API}/46a1b2", json=PHOTO)
    assert [row["label"] for row in await details(hass, feed, "46a1b2")] == ["Route", "Photo"], "a failure isn't cached"


async def test_details_of_an_aircraft_that_has_left_or_a_feed_that_doesnt_exist(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    mock_receiver(aioclient_mock)
    feed, _ = await set_up(hass)
    assert await details(hass, feed, "abcdef") == []
    with pytest.raises(ServiceValidationError) as raised:
        await details(hass, "no-such-feed", "46a1b2")
    assert raised.value.translation_key == "unknown_feed"


async def test_a_feed_whose_receiver_isnt_running_is_no_feed(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock)
    feed, coordinator = await set_up(hass)
    assert await hass.config_entries.async_unload(coordinator.config_entry.entry_id)
    with pytest.raises(ServiceValidationError) as raised:
        await details(hass, feed, "46a1b2")
    assert raised.value.translation_key == "unknown_feed"


async def test_an_address_that_isnt_icao_gets_no_photo_request(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock, aircraft_with(**{"46a1b2": {"hex": "~2a0001", "flight": ""}}))
    feed, _ = await set_up(hass)
    assert await details(hass, feed, "~2a0001") == []
    assert not [call for call in aioclient_mock.mock_calls if "planespotters" in str(call[1])]


async def test_the_nearest_aircraft_is_the_nearest_in_the_air(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock)
    await set_up(hass)
    nearest = hass.states.get(NEAREST_ENTITY)
    # The aircraft on the ground at the airport is nearer, and left out.
    assert nearest.state == "OH-ZZB"
    assert nearest.attributes["hex"] == "461f00"
    assert nearest.attributes["type"] == "C172"
    assert nearest.attributes["altitude"] == 762, "2 500 ft in the receiver's metres"
    assert nearest.attributes["heading"] == 270
    assert 5 < nearest.attributes["distance_km"] < 7


async def test_with_no_aircraft_in_the_air_the_nearest_is_unknown(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    data = local_aircraft()
    data["aircraft"] = [item for item in data["aircraft"] if item["hex"] == "462000"]
    mock_receiver(aioclient_mock, data)
    await set_up(hass)
    assert hass.states.get(NEAREST_ENTITY).state == "unknown"


class Events:
    """What an automation on the feed's event entity sees, as (type, attributes) pairs, through event.received."""

    def __init__(self, calls: list[ServiceCall]) -> None:
        self._calls = calls

    @property
    def fired(self) -> list[tuple[str, dict[str, Any]]]:
        return [(call.data["type"], call.data["attributes"]) for call in self._calls]

    def clear(self) -> None:
        self._calls.clear()

    def types(self) -> list[tuple[str, str]]:
        return [(event_type, data["hex"]) for event_type, data in self.fired]


async def automation(hass: HomeAssistant) -> Events:
    """An automation on every event type of the feed's event entity, set up before the feed."""
    calls = async_mock_service(hass, "test", "event")
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                # Several events can come in one update, and each must run.
                "mode": "queued",
                "triggers": [
                    {
                        "trigger": "event.received",
                        "target": {"entity_id": EVENTS_ENTITY},
                        "options": {"event_type": ["emergency", "military", "overhead"]},
                    }
                ],
                "actions": [
                    {
                        "action": "test.event",
                        "data": {
                            "type": "{{ trigger.to_state.attributes.event_type }}",
                            "attributes": "{{ trigger.to_state.attributes }}",
                        },
                    }
                ],
            }
        },
    )
    return Events(calls)


# The light aircraft circles a kilometre from the receiver at 2 500 ft, a military one, while the airliner squawks 7700.
EVENTFUL = {"461f00": {"lat": 61.49, "lon": 23.75, "dbFlags": 1}, "46a1b2": {"squawk": "7700"}}


async def refresh(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, coordinator: FeedCoordinator, aircraft: dict[str, Any]) -> None:
    aioclient_mock.clear_requests()
    mock_receiver(aioclient_mock, aircraft)
    await coordinator.async_refresh()
    await hass.async_block_till_done()


async def test_an_event_fires_once_while_the_aircraft_stays_in_its_state(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, freezer: FrozenDateTimeFactory
) -> None:
    events = await automation(hass)
    mock_receiver(aioclient_mock)
    _, coordinator = await set_up(hass)

    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert sorted(events.types()) == [("emergency", "46a1b2"), ("military", "461f00"), ("overhead", "461f00")]
    emergency = next(data for event_type, data in events.fired if event_type == "emergency")
    assert emergency["name"] == "EXA123"
    assert emergency["squawk"] == "7700"
    assert emergency["altitude"] == 3658, "12 000 ft in the receiver's metres"
    assert emergency["heading"] == 90

    events.clear()
    freezer.tick(timedelta(minutes=5))
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert events.fired == [], "still in the same states"

    # A failed update tells the entities again with the last data, which must not fire its events again.
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", status=503)
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert events.fired == []

    # Out of its state for a moment, as for an update missed at the edge of coverage, and back.
    freezer.tick(timedelta(minutes=2))
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**{"46a1b2": {"squawk": "4521"}}))
    freezer.tick(timedelta(minutes=2))
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert events.fired == []

    # Gone for longer than ten minutes, and back.
    freezer.tick(timedelta(minutes=11))
    await refresh(hass, aioclient_mock, coordinator, local_aircraft())
    freezer.tick(timedelta(minutes=1))
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert sorted(events.types()) == [("emergency", "46a1b2"), ("military", "461f00"), ("overhead", "461f00")]


async def test_overhead_follows_the_feeds_radius_and_altitude_around_the_areas_centre(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    feed = {
        "area": AREA,
        "adsb_fi": False,
        "refresh_seconds": 15,
        "trail_minutes": 5,
        "color_by_altitude": True,
        "overhead_radius_km": 0,
        "overhead_altitude": 1500,
        "overhead_altitude_unit": "m",
    }
    events = await automation(hass)
    # The light aircraft a kilometre from the receiver, the area's centre, at 2 500 ft, 762 m.
    mock_receiver(aioclient_mock, aircraft_with(**{"461f00": {"lat": 61.49, "lon": 23.75}}))
    _, coordinator = await set_up(hass, feed)
    assert events.fired == [], "a radius of 0 turns overhead off"
    entry = coordinator.config_entry
    subentry = next(iter(entry.subentries.values()))

    # Each change reloads the feed, whose first update counts.
    hass.config_entries.async_update_subentry(entry, subentry, data={**feed, "overhead_radius_km": 5, "overhead_altitude": 500})
    await hass.async_block_till_done()
    assert events.fired == [], "762 m is above 500 m"

    hass.config_entries.async_update_subentry(entry, subentry, data={**feed, "overhead_radius_km": 5, "overhead_altitude": 762})
    await hass.async_block_till_done()
    assert events.fired == [], "762 m isn't below 762 m"

    hass.config_entries.async_update_subentry(entry, subentry, data={**feed, "overhead_radius_km": 5, "overhead_altitude": 800})
    await hass.async_block_till_done()
    assert events.types() == [("overhead", "461f00")]

    # The area moves 20 km north of the receiver: the aircraft is no longer under its centre, though as near the receiver.
    events.clear()
    north = {**AREA, "latitude": AREA["latitude"] + 0.18}
    hass.config_entries.async_update_subentry(
        entry, subentry, data={**feed, "area": north, "overhead_radius_km": 5, "overhead_altitude": 800}
    )
    await hass.async_block_till_done()
    assert events.fired == []


async def test_the_first_updates_events_reach_automations(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    events = await automation(hass)
    mock_receiver(aioclient_mock, aircraft_with(**EVENTFUL))
    _, coordinator = await set_up(hass)
    assert sorted(events.types()) == [("emergency", "46a1b2"), ("military", "461f00"), ("overhead", "461f00")]

    events.clear()
    await hass.config_entries.async_reload(coordinator.config_entry.entry_id)
    await hass.async_block_till_done()
    assert sorted(events.types()) == [("emergency", "46a1b2"), ("military", "461f00"), ("overhead", "461f00")], "a reload starts afresh"


async def test_events_after_a_failed_first_update_reach_automations(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    events = await automation(hass)
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", status=503)
    aioclient_mock.get(f"{RECEIVER_URL}/data/stats.json", json=stats())
    _, coordinator = await set_up(hass)
    assert hass.states.get(EVENTS_ENTITY).state == "unavailable"

    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert sorted(events.types()) == [("emergency", "46a1b2"), ("military", "461f00"), ("overhead", "461f00")]


async def test_an_aircraft_back_after_the_receiver_was_down_fires_again(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, freezer: FrozenDateTimeFactory
) -> None:
    events = await automation(hass)
    mock_receiver(aioclient_mock, aircraft_with(**EVENTFUL))
    _, coordinator = await set_up(hass)
    events.clear()

    # The receiver is down for an hour: no update succeeds that could forget the aircraft.
    freezer.tick(timedelta(minutes=60))
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", status=503)
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert sorted(events.types()) == [("emergency", "46a1b2"), ("military", "461f00"), ("overhead", "461f00")]


async def test_staying_in_a_state_doesnt_fire_again_however_long_the_feeds_interval(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, freezer: FrozenDateTimeFactory
) -> None:
    feed = {
        "area": AREA,
        "adsb_fi": False,
        "refresh_seconds": 600,
        "trail_minutes": 5,
        "color_by_altitude": True,
        "overhead_radius_km": 5,
        "overhead_altitude": 1500,
        "overhead_altitude_unit": "m",
    }
    events = await automation(hass)
    mock_receiver(aioclient_mock, aircraft_with(**EVENTFUL))
    _, coordinator = await set_up(hass, feed)
    events.clear()
    for _ in range(3):
        # Home Assistant's schedule puts the updates of a 600 s feed exactly 600 s apart.
        freezer.tick(timedelta(seconds=600))
        await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert events.fired == []

    # An update that fails in between isn't leaving.
    freezer.tick(timedelta(seconds=600))
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{RECEIVER_URL}/data/aircraft.json", status=503)
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=600))
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert events.fired == []

    # Gone for more than two updates is.
    freezer.tick(timedelta(seconds=600))
    await refresh(hass, aioclient_mock, coordinator, local_aircraft())
    freezer.tick(timedelta(seconds=600))
    await refresh(hass, aioclient_mock, coordinator, local_aircraft())
    freezer.tick(timedelta(seconds=600))
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
    assert sorted(events.types()) == [("emergency", "46a1b2"), ("military", "461f00"), ("overhead", "461f00")]


async def test_a_feed_saved_without_the_overhead_settings_uses_their_defaults(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    feed = {"area": AREA, "adsb_fi": False, "refresh_seconds": 15, "trail_minutes": 5, "color_by_altitude": True}
    events = await automation(hass)
    mock_receiver(aioclient_mock, aircraft_with(**{"461f00": {"lat": 61.49, "lon": 23.75}}))
    await set_up(hass, feed)
    assert events.types() == [("overhead", "461f00")], "5 km and 1 500 m"


async def test_the_heading_is_the_track_or_else_where_the_nose_points(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock, aircraft_with(**{"461f00": {"track": None, "true_heading": 123.4}}))
    await set_up(hass)
    assert hass.states.get(NEAREST_ENTITY).attributes["heading"] == 123
    features = hass.states.get(FEED_ENTITY).attributes["geojson"]["features"]
    assert next(feature for feature in features if feature["id"] == "aircraft:461f00")["properties"]["heading"] == 123, "as on the map"


async def test_odd_answers_leave_out_their_row_and_empty_ones_are_cached(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_receiver(aioclient_mock)
    aioclient_mock.get(f"{ROUTES_URL}/EX/EXA123.json", json={"callsign": "EXA123", "_airports": "TMP-HEL"})
    aioclient_mock.get(f"{PLANESPOTTERS_API}/46a1b2", json={"photos": True})
    feed, _ = await set_up(hass)
    assert await details(hass, feed, "46a1b2") == []

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{ROUTES_URL}/EX/EXA123.json", json={"callsign": "EXA123", "_airports": [ROUTE["_airports"][0]]})
    aioclient_mock.get(f"{PLANESPOTTERS_API}/46a1b2", json={"photos": []})
    client = hass.data[DETAILS_CLIENT]
    client._routes.clear()
    client._photos.clear()
    assert await details(hass, feed, "46a1b2") == [], "a route of one airport, and no photo"
    calls = aioclient_mock.call_count
    assert await details(hass, feed, "46a1b2") == []
    assert aioclient_mock.call_count == calls, "both empty answers cached"


async def test_overhead_in_feet_is_strictly_below_the_limit_shown(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    """A limit entered as 2 000 ft is compared in feet: an aircraft level at 2 000 ft is at the limit, not below it."""
    feed = {
        "area": AREA,
        "adsb_fi": False,
        "refresh_seconds": 15,
        "trail_minutes": 5,
        "color_by_altitude": True,
        "overhead_radius_km": 5,
        "overhead_altitude": 2000,
        "overhead_altitude_unit": "ft",
    }
    events = await automation(hass)
    entry = receiver_entry(hass, feed=feed)
    hass.config_entries.async_update_entry(entry, data={**entry.data, "altitude_unit": "ft"})
    mock_receiver(aioclient_mock, aircraft_with(**{"461f00": {"lat": 61.49, "lon": 23.75, "alt_baro": 2000}}))
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert events.fired == []

    coordinator = next(iter(entry.runtime_data.feeds.values()))
    await refresh(hass, aioclient_mock, coordinator, aircraft_with(**{"461f00": {"lat": 61.49, "lon": 23.75, "alt_baro": 1975}}))
    assert events.types() == [("overhead", "461f00")]
    assert events.fired[0][1]["altitude"] == 1975, "in the receiver's feet"


@pytest.mark.parametrize(("interval", "missed_quietly", "missed_to_fire"), [(250, 2, 3), (45, 13, 14)])
async def test_ten_minutes_out_of_the_state_rearms_at_any_interval(
    hass: HomeAssistant,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
    interval: int,
    missed_quietly: int,
    missed_to_fire: int,
) -> None:
    """Out for fewer updates than cover 10 minutes doesn't count as leaving, out for as many does."""
    feed = {
        "area": AREA,
        "adsb_fi": False,
        "refresh_seconds": interval,
        "trail_minutes": 5,
        "color_by_altitude": True,
        "overhead_radius_km": 5,
        "overhead_altitude": 1500,
        "overhead_altitude_unit": "m",
    }
    events = await automation(hass)
    mock_receiver(aioclient_mock, aircraft_with(**EVENTFUL))
    _, coordinator = await set_up(hass, feed)

    for missed, fires in ((missed_quietly, False), (missed_to_fire, True)):
        events.clear()
        for _ in range(missed):
            freezer.tick(timedelta(seconds=interval))
            await refresh(hass, aioclient_mock, coordinator, local_aircraft())
        freezer.tick(timedelta(seconds=interval))
        await refresh(hass, aioclient_mock, coordinator, aircraft_with(**EVENTFUL))
        assert bool(events.fired) is fires, f"out for {missed * interval} s"
