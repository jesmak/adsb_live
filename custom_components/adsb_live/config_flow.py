"""Config flow.

The config entry is one receiver: its address, and the language and altitude unit
of the feed texts. Each feed is a config subentry, added and changed from the
integration page.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigEntryState,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentry,
    ConfigSubentryFlow,
    SubentryFlowResult,
)
from homeassistant.const import CONF_NAME, CONF_URL
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    BooleanSelector,
    LocationSelector,
    LocationSelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)
from homeassistant.util.unit_system import METRIC_SYSTEM

from .api import ADSB_FI_MAX_AREA_KM, AdsbError, ReceiverClient, normalize_url, without_login
from .const import (
    ALTITUDE_UNITS,
    CONF_ADSB_FI,
    CONF_ALTITUDE_UNIT,
    CONF_AREA,
    CONF_COLOR_BY_ALTITUDE,
    CONF_LANGUAGE,
    CONF_OVERHEAD_ALTITUDE,
    CONF_OVERHEAD_ALTITUDE_UNIT,
    CONF_OVERHEAD_RADIUS,
    CONF_REFRESH_SECONDS,
    CONF_TRAIL_MINUTES,
    DEFAULT_ALTITUDE_UNIT,
    DEFAULT_COLOR_BY_ALTITUDE,
    DEFAULT_OVERHEAD_ALTITUDE,
    DEFAULT_OVERHEAD_RADIUS_KM,
    DEFAULT_RADIUS_M,
    DEFAULT_REFRESH_SECONDS,
    DEFAULT_TRAIL_MINUTES,
    DOMAIN,
    LANGUAGES,
    MAX_OVERHEAD_RADIUS_KM,
    MAX_TRAIL_MINUTES,
    MIN_REFRESH_SECONDS,
    SUBENTRY_FEED,
)
from .geo import METRES_PER_FOOT

DEFAULT_NAME = "ADS-B"


def receiver_schema(include_name: bool) -> vol.Schema:
    fields: dict[Any, Any] = {}
    if include_name:
        fields[vol.Required(CONF_NAME)] = TextSelector()
    fields[vol.Required(CONF_URL)] = TextSelector(TextSelectorConfig(type=TextSelectorType.URL))
    fields[vol.Required(CONF_LANGUAGE)] = SelectSelector(
        SelectSelectorConfig(options=LANGUAGES, translation_key=CONF_LANGUAGE, mode=SelectSelectorMode.DROPDOWN)
    )
    fields[vol.Required(CONF_ALTITUDE_UNIT)] = SelectSelector(
        SelectSelectorConfig(options=ALTITUDE_UNITS, translation_key=CONF_ALTITUDE_UNIT, mode=SelectSelectorMode.DROPDOWN)
    )
    return vol.Schema(fields)


class AdsbLiveConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {**user_input, CONF_URL: normalize_url(user_input[CONF_URL])}
            title = data.pop(CONF_NAME).strip()
            # The receiver is the same whatever login it is reached with, so the login isn't part of its id.
            await self.async_set_unique_id(without_login(data[CONF_URL]))
            self._abort_if_unique_id_configured()
            errors = await self._async_check_receiver(data[CONF_URL])
            if not title:
                errors[CONF_NAME] = "name_required"
            if not errors:
                return self.async_create_entry(title=title, data=data)

        language = self.hass.config.language[:2]
        values = user_input or {
            CONF_NAME: DEFAULT_NAME,
            CONF_LANGUAGE: language if language in LANGUAGES else "en",
            # Feet only where Home Assistant itself uses US customary units.
            CONF_ALTITUDE_UNIT: DEFAULT_ALTITUDE_UNIT if self.hass.config.units is METRIC_SYSTEM else "ft",
        }
        return self.async_show_form(
            step_id="user", data_schema=self.add_suggested_values_to_schema(receiver_schema(True), values), errors=errors
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {**user_input, CONF_URL: normalize_url(user_input[CONF_URL])}
            receiver_id = without_login(data[CONF_URL])
            if any(other.entry_id != entry.entry_id and other.unique_id == receiver_id for other in self._async_current_entries()):
                return self.async_abort(reason="already_configured")
            # Only a new address is checked, so the language or unit can be changed while the receiver is off.
            errors = await self._async_check_receiver(data[CONF_URL]) if data[CONF_URL] != entry.data[CONF_URL] else {}
            if not errors:
                # An entry with an update listener (__init__.py) is reloaded by it, and a setup still running reloads
                # it when it finishes setting up. One whose setup failed would keep its old settings until it is next
                # set up, which is up to ten minutes away in setup retry and never after a setup error, so it is
                # reloaded now. The listener is looked for before the update, which starts its reload at once.
                reload = not entry.update_listeners and entry.state is not ConfigEntryState.SETUP_IN_PROGRESS
                self.hass.config_entries.async_update_entry(entry, unique_id=receiver_id, data=data)
                if reload:
                    self.hass.config_entries.async_schedule_reload(entry.entry_id)
                return self.async_abort(reason="reconfigure_successful")

        # The default fills in a setting added after the entry was saved, as the entry itself uses it.
        values = user_input or {CONF_ALTITUDE_UNIT: DEFAULT_ALTITUDE_UNIT, **entry.data}
        return self.async_show_form(
            step_id="reconfigure", data_schema=self.add_suggested_values_to_schema(receiver_schema(False), values), errors=errors
        )

    async def _async_check_receiver(self, url: str) -> dict[str, str]:
        try:
            await ReceiverClient(async_get_clientsession(self.hass)).receiver(url)
        except AdsbError:
            return {CONF_URL: "cannot_connect"}
        return {}

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        return {SUBENTRY_FEED: FeedFlow}


class FeedFlow(ConfigSubentryFlow):
    """Adding (step "user") and changing (step "reconfigure") one feed with a single form."""

    # The receiver's altitude unit when the form was first shown, which its altitude field is in until it is saved.
    _unit: str | None = None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        return await self._async_step_feed("user", user_input, None)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        return await self._async_step_feed("reconfigure", user_input, self._get_reconfigure_subentry())

    async def _async_step_feed(self, step_id: str, user_input: dict[str, Any] | None, current: ConfigSubentry | None) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            data = dict(user_input)
            title = data.pop(CONF_NAME).strip()
            errors = validate_feed(data)
            if not title:
                errors[CONF_NAME] = "name_required"
            if not errors:
                data[CONF_REFRESH_SECONDS] = int(data[CONF_REFRESH_SECONDS])
                data[CONF_TRAIL_MINUTES] = int(data[CONF_TRAIL_MINUTES])
                data[CONF_OVERHEAD_ALTITUDE] = round(data[CONF_OVERHEAD_ALTITUDE])
                data[CONF_OVERHEAD_ALTITUDE_UNIT] = self.altitude_unit()
                if current is None:
                    return self.async_create_entry(title=title, data=data)
                # The reason named, so the feed's own text shows rather than Home Assistant's generic one.
                return self.async_update_and_abort(self._get_entry(), current, title=title, data=data, reason="reconfigure_successful")

        if user_input is not None:
            values = user_input
        else:
            if current is not None:
                # The defaults fill in settings added after the feed was saved, as the feed itself uses them.
                values = {**FEED_SETTING_DEFAULTS, CONF_NAME: current.title, **current.data}
            else:
                values = self.defaults()
            values[CONF_OVERHEAD_ALTITUDE] = self.altitude_shown(values[CONF_OVERHEAD_ALTITUDE], values[CONF_OVERHEAD_ALTITUDE_UNIT])
        schema = feed_schema(self.altitude_unit())
        return self.async_show_form(step_id=step_id, data_schema=self.add_suggested_values_to_schema(schema, values), errors=errors)

    def altitude_unit(self) -> str:
        if self._unit is None:
            self._unit = self._get_entry().data.get(CONF_ALTITUDE_UNIT, DEFAULT_ALTITUDE_UNIT)
        return self._unit

    def altitude_shown(self, value: float, unit: str) -> int:
        """The stored altitude in the receiver's unit: as it was entered, or converted to the nearest 10 when the
        receiver's unit has changed since, within what the form takes. Saving the form then stores what it shows."""
        unit_now = self.altitude_unit()
        if unit == unit_now:
            return round(value)
        converted = value * METRES_PER_FOOT if unit == "ft" else value / METRES_PER_FOOT
        return min(int(round(converted, -1)), MAX_OVERHEAD_ALTITUDE[unit_now])

    def defaults(self) -> dict[str, Any]:
        """Around the receiver when its position is known, otherwise around home."""
        entry = self._get_entry()
        unit = self.altitude_unit()
        position = entry.runtime_data.receiver.position if entry.state is ConfigEntryState.LOADED else None
        latitude, longitude = position or (self.hass.config.latitude, self.hass.config.longitude)
        return {
            CONF_AREA: {"latitude": latitude, "longitude": longitude, "radius": DEFAULT_RADIUS_M},
            CONF_ADSB_FI: False,
            CONF_REFRESH_SECONDS: DEFAULT_REFRESH_SECONDS,
            CONF_TRAIL_MINUTES: DEFAULT_TRAIL_MINUTES,
            **FEED_SETTING_DEFAULTS,
            CONF_OVERHEAD_ALTITUDE: DEFAULT_OVERHEAD_ALTITUDE[unit],
            CONF_OVERHEAD_ALTITUDE_UNIT: unit,
        }


# The settings a feed saved by an earlier version may lack, with what the feed uses without them.
FEED_SETTING_DEFAULTS = {
    CONF_COLOR_BY_ALTITUDE: DEFAULT_COLOR_BY_ALTITUDE,
    CONF_OVERHEAD_RADIUS: DEFAULT_OVERHEAD_RADIUS_KM,
    CONF_OVERHEAD_ALTITUDE: DEFAULT_OVERHEAD_ALTITUDE["m"],
    CONF_OVERHEAD_ALTITUDE_UNIT: "m",
}

# The highest overhead altitude the form takes, in each unit.
MAX_OVERHEAD_ALTITUDE = {"m": 10_000, "ft": 33_000}


def feed_schema(unit: str) -> vol.Schema:
    """The feed's form, its overhead altitude in the receiver's `unit`."""
    return FEED_SCHEMA.extend(
        {
            vol.Required(CONF_OVERHEAD_RADIUS): NumberSelector(
                NumberSelectorConfig(min=0, max=MAX_OVERHEAD_RADIUS_KM, step=0.1, unit_of_measurement="km", mode=NumberSelectorMode.BOX)
            ),
            vol.Required(CONF_OVERHEAD_ALTITUDE): NumberSelector(
                NumberSelectorConfig(min=0, max=MAX_OVERHEAD_ALTITUDE[unit], step=1, unit_of_measurement=unit, mode=NumberSelectorMode.BOX)
            ),
        }
    )


FEED_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_NAME): TextSelector(),
        vol.Required(CONF_AREA): LocationSelector(LocationSelectorConfig(radius=True, icon="mdi:airplane")),
        vol.Required(CONF_ADSB_FI): BooleanSelector(),
        vol.Required(CONF_REFRESH_SECONDS): NumberSelector(
            NumberSelectorConfig(min=MIN_REFRESH_SECONDS, max=600, step=1, unit_of_measurement="s", mode=NumberSelectorMode.BOX)
        ),
        vol.Required(CONF_TRAIL_MINUTES): NumberSelector(
            NumberSelectorConfig(min=0, max=MAX_TRAIL_MINUTES, step=1, unit_of_measurement="min", mode=NumberSelectorMode.BOX)
        ),
        vol.Required(CONF_COLOR_BY_ALTITUDE): BooleanSelector(),
    }
)


def validate_feed(data: dict[str, Any]) -> dict[str, str]:
    radius_m = data[CONF_AREA].get("radius")
    if not radius_m:
        return {CONF_AREA: "area_radius"}
    if data[CONF_ADSB_FI] and radius_m > ADSB_FI_MAX_AREA_KM * 1000:
        return {CONF_AREA: "adsb_fi_radius"}
    return {}
