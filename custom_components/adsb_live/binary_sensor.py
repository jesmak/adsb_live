"""Each other feeder's connection: on while the feeder sends what the receiver hears to its network."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .coordinator import AdsbConfigEntry
from .feeders import FeederCoordinator


async def async_setup_entry(hass: HomeAssistant, entry: AdsbConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    for subentry_id, coordinator in entry.runtime_data.feeders.items():
        async_add_entities([FeederConnection(coordinator)], config_subentry_id=subentry_id)


class FeederConnection(CoordinatorEntity[FeederCoordinator], BinarySensorEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "feeder_connection"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: FeederCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.subentry.subentry_id}_connection"
        self._attr_device_info = coordinator.device_info

    @property
    def is_on(self) -> bool | None:
        data = self.coordinator.data
        return data.connected if data else None
