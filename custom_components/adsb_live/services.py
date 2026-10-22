"""The actions: an aircraft's route and photo for the map's details, and the receiver's own aircraft for its list."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.update_coordinator import UpdateFailed

from .aircraft import Aircraft
from .api import AdsbError, Airport
from .const import ATTR_DEVICE, ATTR_FEED, ATTR_HEX, DOMAIN, SERVICE_GET_AIRCRAFT_DETAILS, SERVICE_GET_RECEIVER_AIRCRAFT
from .coordinator import AdsbConfigEntry, FeedCoordinator
from .geo import distance_to_leg_km
from .texts import Texts

_LOGGER = logging.getLogger(__name__)

# A callsign's route may be another day's. It is shown only when the aircraft is this near the great circle between
# the route's airports.
ROUTE_PLAUSIBLE_KM = 100

GET_AIRCRAFT_DETAILS_SCHEMA = vol.Schema({vol.Required(ATTR_FEED): cv.string, vol.Required(ATTR_HEX): cv.string})
GET_RECEIVER_AIRCRAFT_SCHEMA = vol.Schema({vol.Required(ATTR_DEVICE): cv.string})


def route_is_plausible(plane: Aircraft, airports: list[Airport]) -> bool:
    point = (plane.latitude, plane.longitude)
    legs = zip(airports, airports[1:], strict=False)
    return any(
        distance_to_leg_km(point, (start.latitude, start.longitude), (end.latitude, end.longitude)) <= ROUTE_PLAUSIBLE_KM
        for start, end in legs
    )


def route_text(airports: list[Airport]) -> str:
    """ "Helsinki (HEL) → Oulu (OUL)"."""
    return " → ".join(f"{airport.name} ({airport.code})" for airport in airports)


def _feed(hass: HomeAssistant, feed_id: str) -> FeedCoordinator:
    entries: list[AdsbConfigEntry] = hass.config_entries.async_loaded_entries(DOMAIN)
    for entry in entries:
        if feed := entry.runtime_data.feeds.get(feed_id):
            return feed
    raise ServiceValidationError(translation_domain=DOMAIN, translation_key="unknown_feed")


def _receiver(hass: HomeAssistant, device_id: str) -> AdsbConfigEntry:
    """The loaded receiver whose device this is. A feed's device is named by its subentry, not by an entry."""
    device = dr.async_get(hass).async_get(device_id)
    for domain, identifier in device.identifiers if device else ():
        entry = hass.config_entries.async_get_entry(identifier) if domain == DOMAIN else None
        if entry is not None and entry.domain == DOMAIN and entry.state is ConfigEntryState.LOADED:
            return entry
    raise ServiceValidationError(translation_domain=DOMAIN, translation_key="unknown_receiver")


async def aircraft_details(feed: FeedCoordinator, hex_code: str) -> list[dict[str, Any]]:
    """The route and photo rows of an aircraft in the feed. A source that fails leaves its row out."""
    found = feed.data.aircraft.get(hex_code) if feed.data else None
    if found is None:
        return []
    plane = found[1]
    runtime = feed.runtime
    texts: Texts = runtime.texts
    rows: list[dict[str, Any]] = []
    try:
        if plane.callsign and (airports := await runtime.details.route(plane.callsign)) and route_is_plausible(plane, airports):
            rows.append({"label": texts("route"), "value": route_text(airports)})
    except AdsbError as err:
        _LOGGER.debug("No route for %s: %s", plane.callsign, err)
    # Addresses starting with ~ aren't ICAO addresses, and no photo is filed under them.
    if not plane.hex.startswith("~"):
        try:
            if photo := await runtime.details.photo(plane.hex):
                credit = texts("photo_credit", photographer=photo.photographer)
                image = {"url": photo.url, "caption": credit, "link": photo.link}
                rows.append({"label": texts("photo"), "value": photo.photographer, "image": image})
        except AdsbError as err:
            _LOGGER.debug("No photo for %s: %s", plane.hex, err)
    return rows


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    async def get_aircraft_details(call: ServiceCall) -> ServiceResponse:
        """An aircraft's details as map feed rows: {"details": [rows]}."""
        feed = _feed(hass, call.data[ATTR_FEED])
        return {"details": await aircraft_details(feed, call.data[ATTR_HEX].lower())}

    async def get_receiver_aircraft(call: ServiceCall) -> ServiceResponse:
        """The aircraft the receiver itself has heard in the last minute: {"aircraft": [...], "altitude_unit": "m"}."""
        entry = _receiver(hass, call.data[ATTR_DEVICE])
        try:
            return await entry.runtime_data.heard.get()
        except (AdsbError, UpdateFailed, ValueError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="receiver_aircraft_failed", translation_placeholders={"error": str(err)}
            ) from err

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_AIRCRAFT_DETAILS,
        get_aircraft_details,
        schema=GET_AIRCRAFT_DETAILS_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_RECEIVER_AIRCRAFT,
        get_receiver_aircraft,
        schema=GET_RECEIVER_AIRCRAFT_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
