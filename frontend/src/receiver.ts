/** What the card reads from a receiver: its sensors, found through the device, and what their values mean. */
import { METER_MAX_DBFS, METER_MIN_DBFS, PLATFORM, RECEIVER_MANUFACTURER, SENSORS } from "./const";
import type { SensorKey } from "./const";
import type { HassEntity, HomeAssistant } from "./hass";
import type { StatisticRow } from "./history";
import type { AdsbReceiverCardConfig } from "./types";

export type Status = "receiving" | "quiet" | "unavailable";
export type FeederState = "ok" | "error" | "unknown";

/** A reading of a sensor, for the curve. Times are milliseconds. */
export interface Point {
    time: number;
    value: number;
}

/** The receivers there are, for the picker and the card's first configuration. */
export function receiverDevices(hass: HomeAssistant): string[] {
    const devices = Object.values(hass.entities ?? {})
        .filter((entry) => entry?.platform === PLATFORM && entry.translation_key === "messages_per_second" && entry.device_id)
        .map((entry) => entry?.device_id as string)
        .filter((device) => hass.devices?.[device]?.manufacturer === RECEIVER_MANUFACTURER);
    return [...new Set(devices)];
}

/** The receiver's sensors by what they are. A sensor the receiver doesn't have, such as one from a newer version, is left out. */
export function receiverSensors(hass: HomeAssistant, device: string): Partial<Record<SensorKey, string>> {
    const found: Partial<Record<SensorKey, string>> = {};
    for (const entry of Object.values(hass.entities ?? {})) {
        const key = entry?.translation_key as SensorKey | undefined;
        if (entry && entry.device_id === device && entry.platform === PLATFORM && key && SENSORS.includes(key)) {
            found[key] = entry.entity_id;
        }
    }
    return found;
}

export function receiverName(hass: HomeAssistant, config: AdsbReceiverCardConfig): string {
    const device = hass.devices?.[config.device];
    return config.name || device?.name_by_user || device?.name || config.device;
}

/** The sensor's number, or null when it has none right now. */
export function valueOf(hass: HomeAssistant, entityId: string | undefined): number | null {
    const state = entityId ? hass.states[entityId]?.state : undefined;
    const value = state === undefined ? Number.NaN : Number.parseFloat(state);
    return Number.isFinite(value) ? value : null;
}

/**
 * Whether the receiver hears anything. An empty sky is the usual reason for no positions, and readsb counts an aircraft
 * it hears without one too, so neither is a fault. Only a positions sensor that is unavailable, or isn't there, makes the
 * receiver unavailable.
 */
export function receiverStatus(hass: HomeAssistant, sensors: Partial<Record<SensorKey, string>>): Status {
    const positions = sensors.positions_per_minute ? hass.states[sensors.positions_per_minute] : undefined;
    if (!positions || positions.state === "unavailable") {
        return "unavailable";
    }
    return (valueOf(hass, sensors.positions_per_minute) ?? 0) > 0 ? "receiving" : "quiet";
}

/** The viewer's language and Home Assistant's number format setting, from the user's profile. */
export interface NumberFormat {
    language: string;
    /** "language", "system", "comma_decimal", "decimal_comma", "space_comma", "quote_decimal" or "none". */
    number_format?: string;
}

/**
 * The locales the number format setting asks for, as Home Assistant's own frontend reads it: `numberFormatToLocale`, except
 * none, which `formatNumberToParts` writes in en-US without grouping.
 */
function numberLocale(format: NumberFormat): string | string[] | undefined {
    switch (format.number_format) {
        case "comma_decimal":
            return ["en-US", "en"];
        case "decimal_comma":
            return ["de", "es", "it"];
        case "space_comma":
            return ["fr", "sv", "cs"];
        case "quote_decimal":
            return ["de-CH"];
        case "none":
            return "en-US";
        case "system":
            return undefined;
        default:
            return format.language;
    }
}

/** A number in the viewer's format, with the sensor's own precision when it has one. */
export function formatNumber(value: number, format: NumberFormat, precision?: number): string {
    return new Intl.NumberFormat(numberLocale(format), {
        ...(precision === undefined ? {} : { minimumFractionDigits: precision, maximumFractionDigits: precision }),
        ...(format.number_format === "none" ? { useGrouping: false } : {}),
    }).format(value);
}

/** Where noise and signal fall on the meter, as percentages of its width. Without noise the meter has nothing to compare with. */
export function meter(signal: number | null, noise: number | null): { noise: number; signal: number | null } | null {
    if (noise === null) {
        return null;
    }
    return { noise: meterPlace(noise), signal: signal === null ? null : meterPlace(signal) };
}

/** Where a level in dBFS falls on the meter's scale, as a percentage, the same for the meter and each aircraft's signal. */
export function meterPlace(level: number): number {
    return ((Math.min(Math.max(level, METER_MIN_DBFS), METER_MAX_DBFS) - METER_MIN_DBFS) / (METER_MAX_DBFS - METER_MIN_DBFS)) * 100;
}

const UP = ["on", "connected", "online", "ok", "home"];
const DOWN = ["off", "disconnected", "offline", "not_home"];

/** A feeder's dot. A problem sensor is on when something is wrong, so it reads the other way. */
export function feederState(entity: HassEntity | undefined): FeederState {
    if (!entity) {
        return "unknown";
    }
    const state = entity.state.toLowerCase();
    const inverted = entity.entity_id.startsWith("binary_sensor.") && entity.attributes.device_class === "problem";
    if (UP.includes(state)) {
        return inverted ? "error" : "ok";
    }
    if (DOWN.includes(state)) {
        return inverted ? "ok" : "error";
    }
    return "unknown";
}

const HALF_HOUR = 30 * 60_000;

/**
 * The curve's points: each hour's mean at the middle of its hour, inside the window, and the sensor's present value at
 * the end, so the curve reaches now although the current hour has no statistics yet.
 */
export function curvePoints(rows: StatisticRow[], start: number, now: number, current: number | null): Point[] {
    const points = rows
        .filter((row) => typeof row.mean === "number" && row.start + HALF_HOUR >= start && row.start <= now)
        .map((row) => ({ time: Math.min(row.start + HALF_HOUR, now), value: row.mean as number }))
        .sort((one, other) => one.time - other.time);
    if (current !== null) {
        points.push({ time: now, value: current });
    }
    return points;
}

/** The most aircraft tracked at once in the window: the hours' maximums, and the present value. */
export function peakOf(rows: StatisticRow[], start: number, current: number | null): number {
    const maximums = rows.filter((row) => row.start + 2 * HALF_HOUR > start).map((row) => row.max ?? row.mean ?? 0);
    return Math.max(0, current ?? 0, ...maximums);
}

/** An SVG path through the points, across a box of the given size, with `max` at the top. */
export function linePath(points: Point[], start: number, end: number, width: number, height: number, max: number): string {
    if (!points.length || end <= start) {
        return "";
    }
    const x = (time: number) => ((Math.min(Math.max(time, start), end) - start) / (end - start)) * width;
    // The line keeps a pixel from the box's edges, so a stroke at zero or at the peak isn't cut in half.
    const y = (value: number) => 1 + (1 - Math.min(Math.max(value, 0), max) / max) * (height - 2);
    // A path of one point strokes nothing, so a lone point is a line of no length, which the round cap shows as a dot.
    const drawn = points.length === 1 ? [points[0], points[0]] : points;
    return drawn.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join("");
}
