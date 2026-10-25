import { describe, expect, it, vi } from "vitest";

import {
    curvePoints,
    feederState,
    formatNumber,
    meter,
    receiverDevices,
    receiverSensors,
    receiverStatus,
    linePath,
    peakOf,
} from "../src/receiver";
import { FEED, RECEIVER, SENSOR_IDS, entity, hass } from "./fixtures";

describe("the receiver", () => {
    it("is a device of the integration's with readsb as its manufacturer, never one of its map feeds", () => {
        expect(receiverDevices(hass())).toEqual([RECEIVER]);
        expect(receiverSensors(hass(), FEED)).toEqual({});
    });

    it("isn't a device without readsb as its manufacturer, even with a sensor of the receiver's kind", () => {
        const state = hass();
        state.entities!["sensor.adsb_feed"] = { ...state.entities!["sensor.adsb_feed"]!, translation_key: "messages_per_second" };
        expect(receiverDevices(state)).toEqual([RECEIVER]);
        state.devices![FEED] = { ...state.devices![FEED]!, manufacturer: "readsb" };
        expect(receiverDevices(state)).toEqual([RECEIVER, FEED]);
    });

    it("has its sensors found by their translation keys", () => {
        expect(receiverSensors(hass(), RECEIVER)).toEqual(SENSOR_IDS);
    });

    it("of an older integration has no aircraft tracked, and the rest are still found", () => {
        const state = hass();
        delete state.entities![SENSOR_IDS.aircraft_tracked];
        const sensors = receiverSensors(state, RECEIVER);
        expect(sensors.aircraft_tracked).toBeUndefined();
        expect(sensors.positions_per_minute).toBe(SENSOR_IDS.positions_per_minute);
    });
});

describe("the status", () => {
    // Only positions coming in count as hearing. An empty sky, or an aircraft heard without a position, is quiet, not a fault.
    it.each([
        { case: "positions coming in", values: { positions_per_minute: "142" }, status: "receiving" },
        { case: "one position a minute", values: { positions_per_minute: "1" }, status: "receiving" },
        { case: "an aircraft heard without a position", values: { positions_per_minute: "0", aircraft_tracked: "1" }, status: "quiet" },
        { case: "an empty sky", values: { positions_per_minute: "0", aircraft_tracked: "0", messages_per_second: "0" }, status: "quiet" },
        { case: "readsb not reporting positions", values: { positions_per_minute: "unknown" }, status: "quiet" },
        { case: "the integration not reaching readsb", values: { positions_per_minute: "unavailable" }, status: "unavailable" },
    ])("is $status with $case", ({ values, status }) => {
        const state = hass(values);
        expect(receiverStatus(state, receiverSensors(state, RECEIVER))).toBe(status);
    });

    it("is unavailable when the receiver has no positions sensor", () => {
        expect(receiverStatus(hass(), {})).toBe("unavailable");
    });
});

describe("numbers", () => {
    it("are written in the viewer's language, with the sensor's precision", () => {
        expect(formatNumber(184.6, { language: "fi" }, 1)).toBe("184,6");
        expect(formatNumber(-39.6, { language: "fi" }, 1)).toBe("−39,6");
        expect(formatNumber(138.2, { language: "en" }, 0)).toBe("138");
        expect(formatNumber(12, { language: "fi" }, 1)).toBe("12,0");
        expect(formatNumber(1234, { language: "en" })).toBe("1,234");
    });

    // Home Assistant's number format setting wins over the language, as its own frontend reads it. Hindi groups unlike
    // every locale a setting maps to, and unlike the test runners' own, so each row can fail on its own.
    const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ").replace(/\u2019/g, "'");
    describe("the number format setting", () => {
        it.each([
            { language: "hi", number_format: undefined, text: "12,34,567.5" },
            { language: "hi", number_format: "language", text: "12,34,567.5" },
            { language: "hi", number_format: "comma_decimal", text: "1,234,567.5" },
            { language: "hi", number_format: "decimal_comma", text: "1.234.567,5" },
            { language: "hi", number_format: "space_comma", text: "1 234 567,5" },
            { language: "hi", number_format: "quote_decimal", text: "1'234'567.5" },
            { language: "hi", number_format: "none", text: "1234567.5" },
            // None is en-US without grouping, not the language without it, so a Finnish interface gets a decimal point.
            { language: "fi", number_format: "none", text: "1234567.5" },
            {
                language: "hi",
                number_format: "system",
                text: new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234567.5),
            },
        ])("follow the number format $number_format in the language $language", ({ language, number_format, text }) => {
            expect(plain(formatNumber(1234567.5, { language, number_format }, 1))).toBe(plain(text));
        });

        // A sensor without a precision of its own leaves the decimals to Intl, still in the setting's format.
        it.each([
            { language: "fi", number_format: "language", text: "1 234 567,125" },
            { language: "hi", number_format: "comma_decimal", text: "1,234,567.125" },
            { language: "fi", number_format: "none", text: "1234567.125" },
        ])("follow the number format $number_format in the language $language without a precision", ({ language, number_format, text }) => {
            expect(plain(formatNumber(1234567.125, { language, number_format }))).toBe(plain(text));
        });

        // The system row's text can't fail on a runner whose own locale is the one a mistake would pick, so the locale is
        // checked too: the system setting leaves it to the browser.
        it("leaves the locale to the browser with the system setting", () => {
            const formats = vi.spyOn(Intl, "NumberFormat");
            formatNumber(1234567.5, { language: "hi", number_format: "system" }, 1);
            expect(formats).toHaveBeenCalledWith(undefined, expect.anything());
            formats.mockRestore();
        });
    });
});

describe("the meter", () => {
    it("places noise and signal on a scale from −50 to 0 dBFS", () => {
        expect(meter(-20, -40)).toEqual({ noise: 20, signal: 60 });
    });

    it("keeps levels beyond the scale at its ends", () => {
        expect(meter(3, -61)).toEqual({ noise: 0, signal: 100 });
    });

    it("shows noise alone after a minute without messages, and nothing for a receiver without a radio of its own", () => {
        expect(meter(null, -40)).toEqual({ noise: 20, signal: null });
        expect(meter(null, null)).toBeNull();
        expect(meter(-20, null)).toBeNull();
    });
});

describe("a feeder's dot", () => {
    // Up and down states, read the other way for a problem binary sensor, whose "on" means something is wrong.
    describe("the dot for each state", () => {
        it.each([
            ...["on", "connected", "online", "ok", "home", "Connected"].flatMap((state) => [
                { id: "sensor.feeder_status", state, device_class: undefined, dot: "ok" },
                { id: "binary_sensor.feeder_problem", state, device_class: "problem", dot: "error" },
            ]),
            ...["off", "disconnected", "offline", "not_home", "Disconnected"].flatMap((state) => [
                { id: "sensor.feeder_status", state, device_class: undefined, dot: "error" },
                { id: "binary_sensor.feeder_problem", state, device_class: "problem", dot: "ok" },
            ]),
            { id: "binary_sensor.fr24_link", state: "on", device_class: "connectivity", dot: "ok" },
            { id: "binary_sensor.fr24_link", state: "off", device_class: "connectivity", dot: "error" },
            // Only a binary sensor reads "problem" the other way round.
            { id: "sensor.feeder_problem", state: "on", device_class: "problem", dot: "ok" },
            { id: "sensor.feeder_status", state: "syncing", device_class: undefined, dot: "unknown" },
            { id: "binary_sensor.fr24_link", state: "unavailable", device_class: "connectivity", dot: "unknown" },
            { id: "binary_sensor.feeder_problem", state: "unknown", device_class: "problem", dot: "unknown" },
        ])("is $dot for $id at $state", ({ id, state, device_class, dot }) => {
            expect(feederState(entity(id, state, device_class ? { device_class } : {}))).toBe(dot);
        });
    });

    it("is unknown for an entity that doesn't exist", () => {
        expect(feederState(undefined)).toBe("unknown");
    });
});

describe("the curve", () => {
    const HOUR = 3_600_000;
    const now = 100 * HOUR + 20 * 60_000;
    const start = now - 24 * HOUR;

    it("has each hour's mean at the middle of its hour, and the present value now", () => {
        const rows = [
            { start: 76 * HOUR - HOUR, mean: 9, max: 9 },
            { start: 76 * HOUR, mean: 1.5, max: 3 },
            { start: 99 * HOUR, mean: 2, max: 4 },
            { start: 100 * HOUR, mean: null, max: null },
        ];
        expect(curvePoints(rows, start, now, 3)).toEqual([
            { time: 76 * HOUR + HOUR / 2, value: 1.5 },
            { time: 99 * HOUR + HOUR / 2, value: 2 },
            { time: now, value: 3 },
        ]);
    });

    it("is only the present value before the recorder has any hours, and nothing without either", () => {
        expect(curvePoints([], start, now, 2)).toEqual([{ time: now, value: 2 }]);
        expect(curvePoints([], start, now, null)).toEqual([]);
    });

    it("peaks at the most aircraft tracked at once, from the hours' maximums in the window and the present value", () => {
        const rows = [
            { start: start - 2 * HOUR, mean: 9, max: 12 },
            { start: start + HOUR, mean: 1.5, max: 5 },
            { start: start + 2 * HOUR, mean: 2 },
        ];
        expect(peakOf(rows, start, 3)).toBe(5);
        expect(peakOf(rows, start, 7)).toBe(7);
        expect(peakOf([], start, null)).toBe(0);
    });

    it("is drawn as a line across the box, with the top at max and a pixel kept from the edges", () => {
        const points = [
            { time: start, value: 0 },
            { time: start + 12 * HOUR, value: 4 },
            { time: now, value: 2 },
        ];
        expect(linePath(points, start, now, 100, 10, 4)).toBe("M0.0,9.0L50.0,1.0L100.0,5.0");
    });

    // A path of one point strokes nothing, so a lone point is a line of no length, which a round cap shows as a dot.
    describe("the curve drawn from its points", () => {
        it.each([
            { case: "no points", points: [], path: "" },
            { case: "only the present value", points: [{ time: now, value: 2 }], path: "M100.0,5.0L100.0,5.0" },
            {
                case: "an hour and the present value",
                points: [
                    { time: start + 12 * HOUR, value: 4 },
                    { time: now, value: 2 },
                ],
                path: "M50.0,1.0L100.0,5.0",
            },
        ])("is drawn so that it shows with $case", ({ points, path }) => {
            expect(linePath(points, start, now, 100, 10, 4)).toBe(path);
        });
    });
});
