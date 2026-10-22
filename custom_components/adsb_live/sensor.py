"""The receiver's health sensors, and per feed a map feed sensor and a sensor for the nearest aircraft.

A feed sensor's state is the number of aircraft; they are in the `geojson`
attribute, in the Map Feed format (docs/map-feed-format.md in map-feed-card).
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription, SensorStateClass
from homeassistant.const import MATCH_ALL, UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .aircraft import aircraft_name
from .api import without_login
from .colors import legend
from .const import ADSB_FI_ATTRIBUTION, ADSB_FI_ATTRIBUTION_URL, DOMAIN, MAP_FEED_VERSION
from .coordinator import AdsbConfigEntry, FeedCoordinator, StatsCoordinator

# The keys are those of health.receiver_health().
HEALTH_SENSORS = (
    SensorEntityDescription(
        key="aircraft_tracked",
        translation_key="aircraft_tracked",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:airplane-search",
    ),
    SensorEntityDescription(
        key="aircraft_with_position",
        translation_key="aircraft_with_position",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:airplane",
    ),
    SensorEntityDescription(
        key="messages_per_second",
        translation_key="messages_per_second",
        native_unit_of_measurement="msg/s",
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
        icon="mdi:message-processing",
    ),
    SensorEntityDescription(
        key="positions_per_minute",
        translation_key="positions_per_minute",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement="/min",
        icon="mdi:crosshairs-gps",
    ),
    SensorEntityDescription(
        key="max_range",
        translation_key="max_range",
        device_class=SensorDeviceClass.DISTANCE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfLength.KILOMETERS,
        suggested_display_precision=0,
        icon="mdi:radar",
    ),
    # Decibels relative to the receiver's full scale, which Home Assistant's signal strength class doesn't take.
    SensorEntityDescription(
        key="signal",
        translation_key="signal",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement="dBFS",
        suggested_display_precision=1,
        icon="mdi:signal",
    ),
    SensorEntityDescription(
        key="noise",
        translation_key="noise",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement="dBFS",
        suggested_display_precision=1,
        icon="mdi:waveform",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: AdsbConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    runtime = entry.runtime_data
    async_add_entities([HealthSensor(runtime.stats, description) for description in HEALTH_SENSORS])
    for subentry_id, coordinator in runtime.feeds.items():
        async_add_entities([MapFeedSensor(coordinator), NearestAircraftSensor(coordinator)], config_subentry_id=subentry_id)


class HealthSensor(CoordinatorEntity[StatsCoordinator], SensorEntity):
    """One of the receiver's statistics. Values readsb doesn't report stay unknown."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: StatsCoordinator, description: SensorEntityDescription) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        entry = coordinator.config_entry
        receiver = entry.runtime_data.receiver
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="readsb",
            sw_version=receiver.version,
            configuration_url=without_login(receiver.url),
        )

    @property
    def native_value(self) -> float | None:
        return (self.coordinator.data or {}).get(self.entity_description.key)


class MapFeedSensor(CoordinatorEntity[FeedCoordinator], SensorEntity):
    # The feed changes on every update and can be tens of kilobytes: only the count goes to the database.
    _unrecorded_attributes = frozenset({MATCH_ALL})
    _attr_has_entity_name = True
    _attr_name = None
    _attr_icon = "mdi:airplane"

    def __init__(self, coordinator: FeedCoordinator) -> None:
        super().__init__(coordinator)
        subentry = coordinator.subentry
        self._attr_unique_id = subentry.subentry_id
        if coordinator.feed_config.adsb_fi:
            self._attr_attribution = ADSB_FI_ATTRIBUTION
        self._attr_device_info = coordinator.device_info

    @property
    def native_value(self) -> int | None:
        data = self.coordinator.data
        return data.count if data else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        runtime = self.coordinator.runtime
        texts = runtime.texts
        attributes: dict[str, Any] = {
            "map_feed_version": MAP_FEED_VERSION,
            "feed_type": "air",
            "area": self.coordinator.feed_config.area.as_attribute(),
            "list": {
                "sort": [
                    {"key": "distance", "label": texts("sort_distance"), "property": "distance_km"},
                    {"key": "altitude", "label": texts("sort_altitude"), "property": "altitude_ft", "order": "desc"},
                ],
                "default": "distance",
                "count": texts("aircraft_count"),
                "count_one": texts("aircraft_count_one"),
            },
        }
        if self.coordinator.feed_config.adsb_fi:
            attributes["attribution_url"] = ADSB_FI_ATTRIBUTION_URL
        data = self.coordinator.data
        if self.coordinator.feed_config.color_by_altitude:
            attributes["legend"] = legend(runtime.altitude_unit, texts, data.unknown_altitude if data else False)
        if data:
            attributes["updated"] = data.updated.isoformat(timespec="seconds")
            attributes["geojson"] = {"type": "FeatureCollection", "features": data.features}
        return attributes


class NearestAircraftSensor(CoordinatorEntity[FeedCoordinator], SensorEntity):
    """The nearest aircraft in the air in the feed, by its name, measured as the feed measures distances."""

    # Its distance and altitude change on every update: only which aircraft it is goes to the database.
    _unrecorded_attributes = frozenset({MATCH_ALL})
    _attr_has_entity_name = True
    _attr_translation_key = "nearest_aircraft"
    _attr_icon = "mdi:airplane-marker"

    def __init__(self, coordinator: FeedCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.subentry.subentry_id}_nearest"
        self._attr_device_info = coordinator.device_info

    @property
    def native_value(self) -> str | None:
        data = self.coordinator.data
        return aircraft_name(data.nearest[1]) if data and data.nearest else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data
        if not data or not data.nearest:
            return {}
        distance_km, plane = data.nearest
        return self.coordinator.event_data(plane, distance_km)
