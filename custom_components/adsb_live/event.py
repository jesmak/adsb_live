"""An event entity per feed: an aircraft with an emergency squawk, a military aircraft, or one low overhead."""

from __future__ import annotations

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .coordinator import EVENT_TYPES, AdsbConfigEntry, FeedCoordinator, FeedData


async def async_setup_entry(hass: HomeAssistant, entry: AdsbConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    for subentry_id, coordinator in entry.runtime_data.feeds.items():
        async_add_entities([AircraftEvents(coordinator)], config_subentry_id=subentry_id)


class AircraftEvents(CoordinatorEntity[FeedCoordinator], EventEntity):
    """Fires once for each aircraft that enters an event's state. Its data tells which aircraft and where."""

    _attr_has_entity_name = True
    _attr_translation_key = "aircraft_events"
    _attr_event_types = list(EVENT_TYPES)

    def __init__(self, coordinator: FeedCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.subentry.subentry_id}_events"
        self._attr_device_info = coordinator.device_info
        # The data whose events have fired: the coordinator tells its entities again with the same data when an
        # update fails, and the first update comes before the entity is added.
        self._fired: FeedData | None = None
        # Whether the state machine shows the entity available, as last written.
        self._shown_available: bool | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # The first update's events fire once the entity has been added: until then Home Assistant drops its writes,
        # and the platform's own first write follows this method.
        self.hass.loop.call_soon(self._fire)

    @callback
    def _handle_coordinator_update(self) -> None:
        self._fire()

    @callback
    def _fire(self) -> None:
        # event.received ignores an event whose previous state is unavailable, so becoming available again is
        # written first, as a state of its own.
        if self.available != self._shown_available:
            self._shown_available = self.available
            self.async_write_ha_state()
        data = self.coordinator.data
        if data is None or data is self._fired:
            return
        self._fired = data
        # Each event is a state of its own: written once after them all, only the last would reach automations.
        for event in data.events:
            self._trigger_event(event.type, event.data)
            self.async_write_ha_state()
