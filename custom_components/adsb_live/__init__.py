"""ADS-B Live: aircraft from your own ADS-B receiver, and optionally adsb.fi, as map feeds.

A config entry is one receiver (readsb, usually behind tar1090), a device with
its health sensors. Each feed is a config subentry with its own coordinator, a
sensor that writes the Map Feed format map-feed-card draws, a sensor for the
nearest aircraft and an event entity. Each other feeder the receiver feeds, such
as Flightradar24, is a config subentry too, with its status (feeders.py).
"""

from __future__ import annotations

import asyncio

from homeassistant.const import CONF_URL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import ADSB_FI_CLIENT, DETAILS_CLIENT, AdsbError, AdsbFiClient, DetailsClient, ReceiverClient, async_user_agent
from .card import async_add_card_resource, async_remove_card_resource, async_serve_card
from .const import CONF_ALTITUDE_UNIT, CONF_LANGUAGE, DEFAULT_ALTITUDE_UNIT, DOMAIN, SUBENTRY_FEEDER
from .coordinator import (
    AdsbConfigEntry,
    AdsbRuntimeData,
    FeedCoordinator,
    Receiver,
    ReceiverAircraft,
    StatsCoordinator,
    TypeKinds,
    receiver_device_info,
)
from .feeders import FeederCoordinator
from .services import async_setup_services
from .texts import async_load_texts

PLATFORMS = [Platform.BINARY_SENSOR, Platform.EVENT, Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_setup_services(hass)
    await async_serve_card(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: AdsbConfigEntry) -> bool:
    # A change saved before the update listener is added below has nothing to reload the entry, so it is looked for then.
    modified = entry.modified_at
    # Before the receiver is reached, so the card is there to show it not answering.
    await async_add_card_resource(hass)
    session = async_get_clientsession(hass)
    client = ReceiverClient(session)
    # Sent to adsb.fi, adsb.lol, the route data and Planespotters.
    user_agent = await async_user_agent(hass)
    if ADSB_FI_CLIENT not in hass.data:
        hass.data[ADSB_FI_CLIENT] = AdsbFiClient(session, user_agent)
        hass.data[DETAILS_CLIENT] = DetailsClient(session, user_agent)
    url = entry.data[CONF_URL]
    try:
        receiver = Receiver.from_json(url, await client.receiver(url))
    except AdsbError as err:
        raise ConfigEntryNotReady(str(err)) from err

    # The feeders' devices name the receiver's by its id, so it is there before the platforms, which set up side by side.
    receiver_device = dr.async_get(hass).async_get_or_create_from_info(
        config_entry_id=entry.entry_id, device_info=receiver_device_info(entry, receiver)
    )

    # A receiver saved before the setting existed in the integration uses the default.
    altitude_unit = entry.data.get(CONF_ALTITUDE_UNIT, DEFAULT_ALTITUDE_UNIT)
    entry.runtime_data = AdsbRuntimeData(
        receiver_client=client,
        adsb_fi=hass.data[ADSB_FI_CLIENT],
        details=hass.data[DETAILS_CLIENT],
        receiver=receiver,
        receiver_device_id=receiver_device.id,
        texts=await async_load_texts(hass, entry.data[CONF_LANGUAGE]),
        altitude_unit=altitude_unit,
        stats=StatsCoordinator(hass, entry, client, url),
        heard=ReceiverAircraft(hass, client, url, altitude_unit),
        types=TypeKinds(hass, client, url),
    )
    for subentry in entry.subentries.values():
        if subentry.subentry_type == SUBENTRY_FEEDER:
            entry.runtime_data.feeders[subentry.subentry_id] = FeederCoordinator(hass, entry, subentry, session, user_agent)
        else:
            entry.runtime_data.feeds[subentry.subentry_id] = FeedCoordinator(hass, entry, subentry)

    # A feed or feeder that fails becomes unavailable and keeps retrying; it doesn't stop the others from loading.
    coordinators = [entry.runtime_data.stats, *entry.runtime_data.feeds.values(), *entry.runtime_data.feeders.values()]
    await asyncio.gather(*(coordinator.async_refresh() for coordinator in coordinators))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Adding, changing or removing a feed (subentry), or changing the receiver's settings, reloads everything.
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    if entry.modified_at != modified:
        hass.config_entries.async_schedule_reload(entry.entry_id)
    return True


async def async_reload_entry(hass: HomeAssistant, entry: AdsbConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: AdsbConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: AdsbConfigEntry) -> None:
    await async_remove_card_resource(hass, entry)
