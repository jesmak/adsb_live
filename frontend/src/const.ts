/** Replaced at build time with the integration's version in manifest.json. */
declare const __CARD_VERSION__: string;

export const CARD_VERSION = __CARD_VERSION__;

/** The integration whose receivers the card shows, and the manufacturer its receiver devices have; its map feeds have none. */
export const PLATFORM = "adsb_live";
export const RECEIVER_MANUFACTURER = "readsb";

/** The receiver's sensors, by their translation key in the integration. */
export const SENSORS = [
    "aircraft_tracked",
    "aircraft_with_position",
    "messages_per_second",
    "positions_per_minute",
    "max_range",
    "signal",
    "noise",
] as const;
export type SensorKey = (typeof SENSORS)[number];

/** How far back the curve of aircraft tracked reaches, and how often it is read again. The statistics change once an hour. */
export const HISTORY_HOURS = 24;
export const HISTORY_REFRESH_MS = 10 * 60_000;

/** How often the open list of aircraft is read again. Its ages count up every second in between. */
export const AIRCRAFT_REFRESH_MS = 10_000;

/** The longest range is readsb's over its last 15 minutes, as one minute is often too short for a distant aircraft. */
export const RANGE_MINUTES = 15;

/** The signal meter's scale. readsb's levels are relative to the receiver's full scale, so 0 dBFS is the loudest it can hear. */
export const METER_MIN_DBFS = -50;
export const METER_MAX_DBFS = 0;
