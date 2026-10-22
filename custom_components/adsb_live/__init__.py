"""ADS-B Live: aircraft from your own ADS-B receiver, and optionally adsb.fi, as map feeds.

A config entry is one receiver (readsb, usually behind tar1090), a device with
its health sensors. Each feed is a config subentry with its own coordinator, a
sensor that writes the Map Feed format map-feed-card draws, a sensor for the
nearest aircraft and an event entity.
"""

from __future__ import annotations

import asyncio

from homeassistant.const import CONF_URL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .api import ADSB_FI_CLIENT, DETAILS_CLIENT, AdsbError, AdsbFiClient, DetailsClient, ReceiverClient
from .const import CONF_ALTITUDE_UNIT, CONF_LANGUAGE, DEFAULT_ALTITUDE_UNIT, DOMAIN
from .coordinator import AdsbConfigEntry, AdsbRuntimeData, FeedCoordinator, Receiver, ReceiverAircraft, StatsCoordinator
from .services import async_setup_services
from .texts import async_load_texts

PLATFORMS = [Platform.EVENT, Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_setup_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: AdsbConfigEntry) -> bool:
    integration = await async_get_integration(hass, DOMAIN)
    session = async_get_clientsession(hass)
    client = ReceiverClient(session)
    if ADSB_FI_CLIENT not in hass.data:
        # Identifies the integration to adsb.fi, the route data and Planespotters, with a way to reach its author.
        # Contains no personal information.
        user_agent = f"{DOMAIN}/{integration.version} (+https://github.com/jesmak/adsb_live)"
        hass.data[ADSB_FI_CLIENT] = AdsbFiClient(session, user_agent)
        hass.data[DETAILS_CLIENT] = DetailsClient(session, user_agent)
    url = entry.data[CONF_URL]
    try:
        receiver = Receiver.from_json(url, await client.receiver(url))
    except AdsbError as err:
        raise ConfigEntryNotReady(str(err)) from err

    # A receiver saved before the setting existed in the integration uses the default.
    altitude_unit = entry.data.get(CONF_ALTITUDE_UNIT, DEFAULT_ALTITUDE_UNIT)
    entry.runtime_data = AdsbRuntimeData(
        receiver_client=client,
        adsb_fi=hass.data[ADSB_FI_CLIENT],
        details=hass.data[DETAILS_CLIENT],
        receiver=receiver,
        texts=await async_load_texts(hass, entry.data[CONF_LANGUAGE]),
        altitude_unit=altitude_unit,
        stats=StatsCoordinator(hass, entry, client, url),
        heard=ReceiverAircraft(client, url, altitude_unit),
    )
    for subentry in entry.subentries.values():
        entry.runtime_data.feeds[subentry.subentry_id] = FeedCoordinator(hass, entry, subentry)

    # A feed that fails becomes unavailable and keeps retrying; it doesn't stop the others from loading.
    coordinators = [entry.runtime_data.stats, *entry.runtime_data.feeds.values()]
    await asyncio.gather(*(coordinator.async_refresh() for coordinator in coordinators))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Adding, changing or removing a feed (subentry), or changing the receiver's settings, reloads everything.
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True


async def async_reload_entry(hass: HomeAssistant, entry: AdsbConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: AdsbConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
