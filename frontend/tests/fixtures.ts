import type { EntityRegistryEntry, HassEntity, HomeAssistant } from "../src/hass";

// A made-up receiver and one of its map feeds, shaped like what ADS-B Live 1.1.0 registers.
export const RECEIVER = "receiver0001";
export const FEED = "feed0001";

export const SENSOR_IDS = {
    aircraft_tracked: "sensor.adsb_aircraft_tracked",
    aircraft_with_position: "sensor.adsb_aircraft_with_position",
    messages_per_second: "sensor.adsb_messages_per_second",
    positions_per_minute: "sensor.adsb_positions_per_minute",
    max_range: "sensor.adsb_longest_range",
    signal: "sensor.adsb_signal",
    noise: "sensor.adsb_noise",
} as const;

const PRECISION: Record<string, number> = { messages_per_second: 1, max_range: 0, signal: 1, noise: 1 };
const UNITS: Record<string, string> = {
    messages_per_second: "msg/s",
    positions_per_minute: "/min",
    max_range: "km",
    signal: "dBFS",
    noise: "dBFS",
};

function entity(entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
    return { entity_id, state, last_changed: "2026-10-14T07:40:00+00:00", attributes };
}

export function hass(values: Partial<Record<keyof typeof SENSOR_IDS, string>> = {}, extra: HassEntity[] = []): HomeAssistant {
    const readings: Record<keyof typeof SENSOR_IDS, string> = {
        aircraft_tracked: "7",
        aircraft_with_position: "5",
        messages_per_second: "184.6",
        positions_per_minute: "142",
        max_range: "138.2",
        signal: "-18.2",
        noise: "-39.6",
        ...values,
    };
    const states: Record<string, HassEntity> = {};
    const entities: Record<string, EntityRegistryEntry> = {};
    for (const [key, id] of Object.entries(SENSOR_IDS)) {
        const unit = UNITS[key];
        states[id] = entity(id, readings[key as keyof typeof SENSOR_IDS], unit ? { unit_of_measurement: unit } : {});
        entities[id] = {
            entity_id: id,
            device_id: RECEIVER,
            platform: "adsb_live",
            translation_key: key,
            display_precision: PRECISION[key],
        };
    }
    // The feed's sensors share the integration but not the receiver's manufacturer.
    states["sensor.adsb_feed"] = entity("sensor.adsb_feed", "12");
    entities["sensor.adsb_feed"] = { entity_id: "sensor.adsb_feed", device_id: FEED, platform: "adsb_live" };
    for (const extraEntity of extra) {
        states[extraEntity.entity_id] = extraEntity;
    }
    return {
        locale: { language: "fi" },
        // ADS-B Live's actions, as Home Assistant lists them. The aircraft list needs get_receiver_aircraft.
        services: { adsb_live: { get_aircraft_details: {}, get_receiver_aircraft: {} } },
        states,
        entities,
        devices: {
            [RECEIVER]: { id: RECEIVER, name: "ADS-B", manufacturer: "readsb", sw_version: "3.16.17" },
            [FEED]: { id: FEED, name: "Lentokoneet" },
        },
        formatEntityState: (state) =>
            state.state === "on"
                ? "Yhdistetty"
                : state.state === "off"
                  ? "Katkaistu"
                  : `${state.state} ${state.attributes.unit_of_measurement ?? ""}`.trim(),
    };
}

export { entity };
