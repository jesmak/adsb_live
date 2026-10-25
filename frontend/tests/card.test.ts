import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../src/adsb-receiver-card";
import type { AdsbReceiverCard } from "../src/adsb-receiver-card";
import { HISTORY_REFRESH_MS } from "../src/const";
import { compactFeeders } from "../src/editor";
import type { HomeAssistant } from "../src/hass";
import type { AdsbReceiverCardConfig } from "../src/types";
import { RECEIVER, SENSOR_IDS, entity, hass } from "./fixtures";

const NOW = Date.parse("2026-10-14T07:40:00Z");

async function card(state: HomeAssistant, config: Partial<AdsbReceiverCardConfig> = {}): Promise<AdsbReceiverCard> {
    const element = document.createElement("adsb-receiver-card");
    element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...config } as AdsbReceiverCardConfig);
    element.hass = state;
    document.body.append(element);
    await element.updateComplete;
    return element;
}

function text(element: Element | null | undefined): string {
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

const FEEDERS = [
    entity("binary_sensor.fr24_link", "on", { friendly_name: "Linkki", device_class: "connectivity" }),
    entity("sensor.fr24_reported", "5", { unit_of_measurement: "lentoalusta" }),
];

describe("adsb-receiver-card", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("shows the receiver's state, its figures, the meter and a feeder", async () => {
        const element = await card(hass({}, FEEDERS), {
            feeders: [{ entity: "binary_sensor.fr24_link", name: "Flightradar24", detail: "sensor.fr24_reported" }],
        });
        const root = element.shadowRoot!;
        expect(root.querySelector("ha-card")?.classList.contains("receiving")).toBe(true);
        expect(text(root.querySelector(".name"))).toBe("ADS-B");
        expect(text(root.querySelector(".status"))).toBe("Kuulee");
        expect(text(root.querySelector(".rates"))).toBe("184,6 viestiä/s, 142 sijaintia/min");
        expect(text(root.querySelector(".version"))).toBe("readsb 3.16.17");
        expect([...root.querySelectorAll(".figure")].map(text)).toEqual(["7 seurannassa", "5 sijainnilla", "138 km kantama, 15 min"]);
        expect(text(root.querySelector(".levels"))).toBe("Kohina −39,6 dBFS Signaali −18,2 dBFS");
        expect(text(root.querySelector(".feeder"))).toBe("Flightradar24 Yhdistetty, 5 lentoalusta");
        expect(root.querySelector(".feeder .dot")?.classList.contains("ok")).toBe(true);
    });

    it("writes one position a minute in the singular", async () => {
        const element = await card(hass({ positions_per_minute: "1" }));
        expect(text(element.shadowRoot!.querySelector(".rates"))).toBe("184,6 viestiä/s, 1 sijainti/min");
    });

    it("is quiet in grey when nothing comes with a position", async () => {
        const element = await card(hass({ positions_per_minute: "0", aircraft_with_position: "0", aircraft_tracked: "1" }));
        const root = element.shadowRoot!;
        expect(root.querySelector("ha-card")?.classList.contains("quiet")).toBe(true);
        expect(text(root.querySelector(".status"))).toBe("Hiljaista");
        expect(text(root.querySelector(".figure"))).toBe("1 seurannassa");
    });

    // What each layout shows in each status. An unavailable receiver keeps only what doesn't come from its sensors: its name
    // and status, and in the full layout its version and feeders.
    const PARTS = [".rates", ".version", ".figures", ".curve", ".meter", ".aircraft", ".feeder", ".line", ".small-curve"];
    describe("each layout in each status", () => {
        const FULL = [".rates", ".version", ".figures", ".curve", ".meter", ".aircraft", ".feeder"];
        const COMPACT = [".line", ".small-curve"];
        // Unavailable means the positions sensor is unavailable or isn't there, whatever the other sensors say.
        const everything = Object.fromEntries(Object.keys(SENSOR_IDS).map((key) => [key, "unavailable"]));
        const VALUES: Record<string, Partial<Record<keyof typeof SENSOR_IDS, string>>> = {
            receiving: { positions_per_minute: "142" },
            quiet: { positions_per_minute: "0" },
            "all unavailable": everything,
            "only it unavailable": { positions_per_minute: "unavailable" },
            "only it receiving": { ...everything, positions_per_minute: "142" },
            missing: {},
            "without a state": {},
        };
        it.each([
            { layout: "full", positions: "receiving", status: "Kuulee", shown: FULL },
            { layout: "full", positions: "quiet", status: "Hiljaista", shown: FULL },
            { layout: "full", positions: "all unavailable", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            { layout: "full", positions: "only it unavailable", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            { layout: "full", positions: "missing", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            { layout: "full", positions: "without a state", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            // Without noise the meter has nothing to compare with, so it is left out.
            {
                layout: "full",
                positions: "only it receiving",
                status: "Kuulee",
                shown: [".rates", ".version", ".figures", ".curve", ".aircraft", ".feeder"],
            },
            { layout: "compact", positions: "receiving", status: "Kuulee", shown: COMPACT },
            { layout: "compact", positions: "quiet", status: "Hiljaista", shown: COMPACT },
            { layout: "compact", positions: "all unavailable", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "only it unavailable", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "missing", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "without a state", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "only it receiving", status: "Kuulee", shown: COMPACT },
        ])("in the $layout layout with positions $positions shows $shown", async ({ layout, positions, status, shown }) => {
            const state = hass(VALUES[positions], FEEDERS);
            if (positions === "missing") {
                delete state.entities![SENSOR_IDS.positions_per_minute];
            }
            if (positions === "without a state") {
                delete state.states[SENSOR_IDS.positions_per_minute];
            }
            const element = await card(state, {
                layout: layout as AdsbReceiverCardConfig["layout"],
                feeders: [{ entity: "binary_sensor.fr24_link" }],
            });
            const root = element.shadowRoot!;
            expect(text(root.querySelector(".name"))).toBe(`ADS-B${layout === "compact" ? ` ${status}` : ""}`);
            expect(text(root.querySelector(".status"))).toBe(status);
            expect(PARTS.filter((part) => root.querySelector(part))).toEqual(shown);
            if (shown.includes(".version")) {
                expect(text(root.querySelector(".version"))).toBe("readsb 3.16.17");
            }
        });
    });

    // The dot of the present value alone means the recorder has no hour yet, so the curve waits for the recorder's answer.
    // A refresh that fails keeps the curve the card has, and one that answers replaces it.
    describe("the curve before and after its statistics", () => {
        const NOTHING = { full: "", small: "", lone: false, peak: "" };
        const LONE = { full: "M360.0,22.0L360.0,22.0", small: "M90.0,16.0L90.0,16.0", lone: true, peak: "huippu 2" };
        const HOUR = { full: "M180.0,1.0L360.0,22.0", small: "M45.0,1.0L90.0,16.0", lone: false, peak: "huippu 4" };
        it.each([
            { answers: ["pending"], ...NOTHING },
            { answers: ["failed"], ...NOTHING },
            { answers: ["no hours"], ...LONE },
            { answers: ["an hour"], ...HOUR },
            { answers: ["an hour", "failed"], ...HOUR },
            { answers: ["an hour", "no hours"], ...LONE },
            { answers: ["failed", "an hour"], ...HOUR },
            { answers: ["no hours", "an hour"], ...HOUR },
            { answers: ["no hours", "failed"], ...LONE },
        ])("is drawn from the recorder's answers $answers", async ({ answers, full, small, lone, peak }) => {
            vi.useRealTimers();
            vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const draw = async (layout: AdsbReceiverCardConfig["layout"]) => {
                const state = hass({ aircraft_tracked: "2" });
                let call = 0;
                state.callWS = (async () => {
                    const answer = answers[Math.min(call++, answers.length - 1)];
                    if (answer === "pending") {
                        return new Promise(() => undefined);
                    }
                    if (answer === "failed") {
                        throw new Error("the websocket closed");
                    }
                    const hour = { start: Date.now() - 12.5 * 3_600_000, mean: 4, max: 4 };
                    return { [SENSOR_IDS.aircraft_tracked]: answer === "an hour" ? [hour] : [] };
                }) as HomeAssistant["callWS"];
                const element = await card(state, { layout });
                for (let refresh = 1; refresh < answers.length; refresh++) {
                    await vi.advanceTimersByTimeAsync(HISTORY_REFRESH_MS);
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
                await element.updateComplete;
                return element.shadowRoot!;
            };

            const fullCard = await draw("full");
            const drawn = fullCard.querySelector(".curve path");
            expect(drawn?.getAttribute("d")).toBe(full);
            expect(drawn?.classList.contains("lone")).toBe(lone);
            expect([...fullCard.querySelectorAll(".caption span")].map(text)).toEqual(["24 h sitten", peak, "nyt"]);

            document.body.innerHTML = "";
            const drawnSmall = (await draw("compact")).querySelector(".small-curve path");
            expect(drawnSmall?.getAttribute("d")).toBe(small);
            expect(drawnSmall?.classList.contains("lone")).toBe(lone);
            warn.mockRestore();
        });
    });

    // Every number the card writes follows the number format, the ones inside its texts too. Persian has digits of its own.
    describe("the numbers in the texts", () => {
        it.each([
            { language: "fi", number_format: undefined, past: "24 h sitten", peak: "huippu 4", range: "kantama, 15 min" },
            { language: "fa", number_format: undefined, past: "۲۴ h ago", peak: "peak ۴", range: "range, ۱۵ min" },
            { language: "fa", number_format: "language", past: "۲۴ h ago", peak: "peak ۴", range: "range, ۱۵ min" },
            { language: "fa", number_format: "none", past: "24 h ago", peak: "peak 4", range: "range, 15 min" },
            { language: "fa", number_format: "comma_decimal", past: "24 h ago", peak: "peak 4", range: "range, 15 min" },
        ])(
            "are written in the language $language with the format $number_format",
            async ({ language, number_format, past, peak, range }) => {
                const state = { ...hass({ aircraft_tracked: "2" }), locale: { language, number_format } };
                state.callWS = (async () => ({
                    [SENSOR_IDS.aircraft_tracked]: [{ start: NOW - 12.5 * 3_600_000, mean: 4, max: 4 }],
                })) as HomeAssistant["callWS"];
                const element = await card(state);
                await new Promise((resolve) => setTimeout(resolve, 0));
                await element.updateComplete;
                const root = element.shadowRoot!;
                const caption = [...root.querySelectorAll(".caption span")].map(text);
                expect([caption[0], caption[1]]).toEqual([past, peak]);
                // The no-break space keeps the minutes and "min" together when the narrow card breaks the label.
                const label = root.querySelectorAll(".figure .label")[2]?.textContent?.trim();
                expect(label).toBe(range.replace(" min", "\u00a0min"));
            },
        );
    });

    it("of an older ADS-B Live shows a dash for the aircraft tracked, and no curve", async () => {
        const state = hass();
        delete state.entities![SENSOR_IDS.aircraft_tracked];
        const full = await card(state);
        expect(text(full.shadowRoot!.querySelector(".figure"))).toBe("– seurannassa");
        expect(full.shadowRoot!.querySelector(".curve")).toBeNull();

        document.body.innerHTML = "";
        const compact = await card(state, { layout: "compact" });
        expect(text(compact.shadowRoot!.querySelector(".line"))).toBe("– seurannassa, 5 sijainnilla, 184,6 viestiä/s");
        expect(compact.shadowRoot!.querySelector(".small-curve")).toBeNull();
    });

    it("says when a signal is unknown, and leaves the meter out without noise", async () => {
        const element = await card(hass({ signal: "unknown" }));
        expect(text(element.shadowRoot!.querySelector(".levels"))).toBe("Kohina −39,6 dBFS Signaali ei tiedossa");
        expect(element.shadowRoot!.querySelector(".mark.signal")).toBeNull();

        document.body.innerHTML = "";
        const networked = await card(hass({ signal: "unknown", noise: "unknown" }));
        expect(networked.shadowRoot!.querySelector(".meter")).toBeNull();
    });

    describe("the entities a feeder names", () => {
        it.each([
            { entity: "binary_sensor.fr24_link", detail: undefined, row: "Linkki Yhdistetty" },
            { entity: "binary_sensor.fr24_link", detail: "sensor.fr24_reported", row: "Linkki Yhdistetty, 5 lentoalusta" },
            { entity: "binary_sensor.fr24_link", detail: "sensor.missing", row: "Linkki Yhdistetty, Entiteettiä sensor.missing ei löydy" },
            { entity: "binary_sensor.missing", detail: undefined, row: "binary_sensor.missing Entiteettiä binary_sensor.missing ei löydy" },
            {
                entity: "binary_sensor.missing",
                detail: "sensor.fr24_reported",
                row: "binary_sensor.missing Entiteettiä binary_sensor.missing ei löydy, 5 lentoalusta",
            },
            {
                entity: "binary_sensor.missing",
                detail: "sensor.missing",
                row: "binary_sensor.missing Entiteettiä binary_sensor.missing ei löydy, Entiteettiä sensor.missing ei löydy",
            },
        ])("shows a feeder of $entity with $detail as its states, or says which entity isn't there", async ({ entity, detail, row }) => {
            const element = await card(hass({}, FEEDERS), { feeders: [{ entity, detail }] });
            expect(text(element.shadowRoot!.querySelector(".feeder"))).toBe(row);
        });
    });

    it("says so when the device doesn't exist or isn't a receiver", async () => {
        const missing = await card(hass(), { device: "nothing0001" });
        expect(text(missing.shadowRoot!.querySelector("ha-card"))).toBe("Vastaanotinta ei löydy");

        document.body.innerHTML = "";
        const state = hass();
        state.devices!["lamp0001"] = { id: "lamp0001", name: "Lamp" };
        const lamp = await card(state, { device: "lamp0001" });
        expect(text(lamp.shadowRoot!.querySelector("ha-card"))).toBe("Vastaanotinta ei löydy");
    });

    // What makes the card draw itself again: anything it formats with, and the states it shows, but no other state.
    describe("what draws the card again", () => {
        it.each([
            {
                change: "the locale",
                next: (state: HomeAssistant) => ({ ...state, locale: { language: "fi", number_format: "comma_decimal" } }),
                redraw: true,
            },
            { change: "the language", next: (state: HomeAssistant) => ({ ...state, language: "en" }), redraw: true },
            {
                change: "the entity registry",
                next: (state: HomeAssistant) => ({ ...state, entities: { ...state.entities } }),
                redraw: true,
            },
            { change: "the device registry", next: (state: HomeAssistant) => ({ ...state, devices: { ...state.devices } }), redraw: true },
            {
                change: "the state formatter",
                next: (state: HomeAssistant) => ({ ...state, formatEntityState: () => "Yhdistetty" }),
                redraw: true,
            },
            { change: "a receiver's sensor", next: (state: HomeAssistant) => withState(state, SENSOR_IDS.signal, "-20.0"), redraw: true },
            { change: "a feeder", next: (state: HomeAssistant) => withState(state, "binary_sensor.fr24_link", "off"), redraw: true },
            { change: "a feeder's detail", next: (state: HomeAssistant) => withState(state, "sensor.fr24_reported", "6"), redraw: true },
            {
                change: "Home Assistant's actions",
                next: (state: HomeAssistant) => ({ ...state, services: { ...state.services } }),
                redraw: true,
            },
            { change: "another entity", next: (state: HomeAssistant) => withState(state, "light.kitchen", "on"), redraw: false },
        ])("draws itself again when $change changes: $redraw", async ({ next, redraw }) => {
            const state = hass({}, FEEDERS);
            const element = await card(state, {
                feeders: [{ entity: "binary_sensor.fr24_link", detail: "sensor.fr24_reported" }],
            });
            element.hass = next(state);
            const changed = new Map<PropertyKey, unknown>([["hass", state]]);
            expect((element as unknown as { shouldUpdate(changed: Map<PropertyKey, unknown>): boolean }).shouldUpdate(changed)).toBe(
                redraw,
            );
        });
    });

    it("forgets the last receiver's curve when another is picked", async () => {
        const state = hass({ aircraft_tracked: "2" });
        state.entities!["sensor.second_tracked"] = {
            entity_id: "sensor.second_tracked",
            device_id: "receiver0002",
            platform: "adsb_live",
            translation_key: "aircraft_tracked",
        };
        state.entities!["sensor.second_positions"] = {
            entity_id: "sensor.second_positions",
            device_id: "receiver0002",
            platform: "adsb_live",
            translation_key: "positions_per_minute",
        };
        state.states["sensor.second_tracked"] = entity("sensor.second_tracked", "2");
        state.states["sensor.second_positions"] = entity("sensor.second_positions", "0");
        state.devices!["receiver0002"] = { id: "receiver0002", name: "Toinen", manufacturer: "readsb" };
        state.callWS = (async (message: Record<string, unknown>) =>
            (message.statistic_ids as string[])[0] === SENSOR_IDS.aircraft_tracked
                ? { [SENSOR_IDS.aircraft_tracked]: [{ start: NOW - 12.5 * 3_600_000, mean: 4, max: 6 }] }
                : new Promise(() => undefined)) as HomeAssistant["callWS"];
        const element = await card(state);
        await vi.waitFor(() => expect(text(element.shadowRoot!.querySelector(".caption"))).toBe("24 h sitten huippu 6 nyt"));

        element.setConfig({ type: "custom:adsb-receiver-card", device: "receiver0002" } as AdsbReceiverCardConfig);
        await element.updateComplete;
        await element.updateComplete;
        expect(text(element.shadowRoot!.querySelector(".caption"))).toBe("24 h sitten nyt");
        // Nothing of the first receiver is left while the second one's statistics are on the way.
        expect(element.shadowRoot!.querySelector(".curve path")?.getAttribute("d")).toBe("");
    });

    it("puts the same on one row in the compact layout, without the feeders", async () => {
        const element = await card(hass({}, FEEDERS), { layout: "compact", feeders: [{ entity: "binary_sensor.fr24_link" }] });
        const root = element.shadowRoot!;
        expect(text(root.querySelector(".name"))).toBe("ADS-B Kuulee");
        expect(text(root.querySelector(".line"))).toBe("7 seurannassa, 5 sijainnilla, 184,6 viestiä/s");
        expect(root.querySelector(".small-curve")).not.toBeNull();
        expect(root.querySelector(".feeder")).toBeNull();
    });

    it("opens a figure's sensor when it is tapped", async () => {
        const element = await card(hass());
        const opened: string[] = [];
        element.addEventListener("hass-more-info", (event) => opened.push((event as CustomEvent<{ entityId: string }>).detail.entityId));
        element.shadowRoot!.querySelector<HTMLButtonElement>(".figure")!.click();
        expect(opened).toEqual([SENSOR_IDS.aircraft_tracked]);
    });

    it("draws the curve from the recorder's hourly statistics", async () => {
        const state = hass({ aircraft_tracked: "2" });
        const asked: Array<Record<string, unknown>> = [];
        state.callWS = (async (message: Record<string, unknown>) => {
            asked.push(message);
            return {
                [SENSOR_IDS.aircraft_tracked]: [
                    { start: NOW - 23.5 * 3_600_000, mean: 0, max: 1 },
                    { start: NOW - 12.5 * 3_600_000, mean: 4, max: 6 },
                ],
            };
        }) as HomeAssistant["callWS"];
        const element = await card(state);
        await vi.waitFor(() => expect(text(element.shadowRoot!.querySelector(".caption"))).toBe("24 h sitten huippu 6 nyt"));
        expect(asked[0]).toMatchObject({
            type: "recorder/statistics_during_period",
            statistic_ids: [SENSOR_IDS.aircraft_tracked],
            period: "hour",
        });
        expect(element.shadowRoot!.querySelector(".curve path")?.getAttribute("d")).toBe("M15.0,43.0L180.0,15.0L360.0,29.0");
        expect(element.shadowRoot!.querySelector(".curve path")?.classList.contains("lone")).toBe(false);
    });

    describe("the aircraft list", () => {
        const PLANE = {
            hex: "46a1b2",
            name: "EXA123",
            registration: "OH-ZZA",
            type: "A320",
            altitude: 3658,
            speed_kmh: 556,
            rssi: -8.4,
            position: true,
        };
        const heard = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
        /** An answer, a failure, one that never comes, or one that comes when the test resolves it. */
        type Answer = Record<string, unknown> | "failed" | "pending" | Promise<Record<string, unknown>>;

        /** A card whose action answers in turn, the last answer again after the others, and every call it got. */
        async function withList(
            answers: Answer[],
            config: Partial<AdsbReceiverCardConfig> = { list_open: true },
            change: (state: HomeAssistant) => void = () => undefined,
        ) {
            vi.useRealTimers();
            vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
            const state = hass();
            change(state);
            const calls: Array<Record<string, unknown>> = [];
            state.callWS = (async (message: Record<string, unknown>) => {
                if (message.type !== "call_service") {
                    return {};
                }
                calls.push(message);
                const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
                if (answer instanceof Promise) {
                    return { response: await answer };
                }
                if (answer === "pending") {
                    return new Promise(() => undefined);
                }
                if (answer === "failed") {
                    throw new Error("Action adsb_live.get_receiver_aircraft failed");
                }
                return { response: answer };
            }) as HomeAssistant["callWS"];
            const element = await card(state, config);
            await settle(element);
            return { element, calls, root: element.shadowRoot!, state };
        }

        const heading = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>(".aircraft .list-heading");
        /** Whether the list is open: its fold slides open, and a shut one can't be reached. */
        const isOpen = (root: ShadowRoot) => {
            const fold = root.querySelector(".aircraft .fold");
            return !!fold?.classList.contains("open") && !fold.hasAttribute("inert");
        };

        async function settle(element: AdsbReceiverCard): Promise<void> {
            await new Promise((resolve) => setTimeout(resolve, 0));
            await element.updateComplete;
        }

        const rows = (root: ShadowRoot) => [...root.querySelectorAll(".plane")];

        it("stays closed and reads nothing until its heading is tapped, then reads every 10 seconds until it is closed", async () => {
            const { element, calls, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }], {});
            expect(text(heading(root))).toBe("Kuultavat koneet");
            expect(isOpen(root)).toBe(false);
            expect(rows(root)).toHaveLength(0);
            expect(calls).toHaveLength(0);

            heading(root)!.click();
            await settle(element);
            expect(calls).toEqual([
                {
                    type: "call_service",
                    domain: "adsb_live",
                    service: "get_receiver_aircraft",
                    service_data: { device: RECEIVER },
                    return_response: true,
                },
            ]);
            expect(text(heading(root))).toBe("Kuultavat koneet 1");
            expect(isOpen(root)).toBe(true);
            expect(rows(root)).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(9_000);
            expect(calls).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(calls).toHaveLength(2);

            heading(root)!.click();
            await settle(element);
            // Shut, it keeps its rows to slide shut over, out of reach.
            expect(isOpen(root)).toBe(false);
            expect(text(heading(root))).toBe("Kuultavat koneet");
            await vi.advanceTimersByTimeAsync(30_000);
            expect(calls).toHaveLength(2);
        });

        // Read only while the list is on screen: open, in the full layout, of a receiver that isn't unavailable, with the
        // action there. Otherwise nothing is read, however long the list has been open.
        describe("when the list is read", () => {
            it.each([
                { layout: "full", status: "receiving", action: true, calls: 4 },
                { layout: "full", status: "quiet", action: true, calls: 4 },
                { layout: "full", status: "unavailable", action: true, calls: 0 },
                { layout: "full", status: "receiving", action: false, calls: 0 },
                { layout: "compact", status: "receiving", action: true, calls: 0 },
            ])(
                "reads $calls times in 30 s in the $layout layout when $status, with the action $action",
                async ({ layout, status, action, calls: count }) => {
                    const positions = { receiving: "142", quiet: "0", unavailable: "unavailable" }[status]!;
                    const { calls, element } = await withList(
                        [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                        { list_open: true, layout: layout as AdsbReceiverCardConfig["layout"] },
                        (state) => {
                            state.states[SENSOR_IDS.positions_per_minute] = entity(SENSOR_IDS.positions_per_minute, positions);
                            if (!action) {
                                state.services = { adsb_live: { get_aircraft_details: {} } };
                            }
                        },
                    );
                    const renders = vi.spyOn(element as unknown as { render(): unknown }, "render");
                    await vi.advanceTimersByTimeAsync(30_000);
                    expect(calls).toHaveLength(count);
                    // Off the card, the ages aren't moved on either, so the card isn't drawn again every second.
                    expect(renders.mock.calls.length > 0).toBe(count > 0);
                    renders.mockRestore();
                },
            );
        });

        it("shows a kept list's ages as they are the moment the receiver comes back", async () => {
            const { element, state, root } = await withList(
                [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }, "pending"],
                { list_open: true },
            );
            const positions = (value: string) => ({
                ...state,
                states: { ...state.states, [SENSOR_IDS.positions_per_minute]: entity(SENSOR_IDS.positions_per_minute, value) },
            });
            element.hass = positions("unavailable");
            await vi.advanceTimersByTimeAsync(120_000);
            // Back, and drawn at once, before the next second's tick: heard 121 s ago.
            element.hass = positions("142");
            await element.updateComplete;
            expect(text(root.querySelector(".plane .sub"))).toBe("556 km/h · 2 min");
        });

        it("stops reading while the receiver is unavailable, and reads again as soon as it comes back", async () => {
            const { element, calls, state, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }], {
                list_open: true,
            });
            expect(calls).toHaveLength(1);
            const positions = (value: string) => ({
                ...state,
                states: { ...state.states, [SENSOR_IDS.positions_per_minute]: entity(SENSOR_IDS.positions_per_minute, value) },
            });
            element.hass = positions("unavailable");
            await vi.advanceTimersByTimeAsync(30_000);
            expect(calls).toHaveLength(1);
            expect(root.querySelector(".aircraft")).toBeNull();

            element.hass = positions("142");
            await vi.advanceTimersByTimeAsync(1_000);
            await settle(element);
            expect(calls).toHaveLength(2);
            expect(text(heading(root))).toBe("Kuultavat koneet 1");
            expect(rows(root).map((row) => text(row.querySelector(".callsign")))).toEqual(["EXA123"]);
        });

        it("drops a receiver's list at once when another is picked, and its late answer with it", async () => {
            let late: (answer: Record<string, unknown>) => void = () => undefined;
            const answers: Answer[] = [
                { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                new Promise((resolve) => (late = resolve)),
                { aircraft: [{ ...PLANE, name: "BRAVO", heard: heard(1) }], altitude_unit: "m" },
            ];
            const { element, calls, root, state } = await withList(answers);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(calls).toHaveLength(2);

            state.entities!["sensor.second_positions"] = {
                entity_id: "sensor.second_positions",
                device_id: "receiver0002",
                platform: "adsb_live",
                translation_key: "positions_per_minute",
            };
            state.states["sensor.second_positions"] = entity("sensor.second_positions", "0");
            state.devices!["receiver0002"] = { id: "receiver0002", name: "Toinen", manufacturer: "readsb" };
            element.hass = { ...state };
            element.setConfig({ type: "custom:adsb-receiver-card", device: "receiver0002", list_open: true } as AdsbReceiverCardConfig);
            await settle(element);
            // The first receiver's reading is still on the way, and its list is gone already.
            expect(rows(root)).toHaveLength(0);
            expect(text(heading(root))).toBe("Kuultavat koneet");

            late({ aircraft: [{ ...PLANE, name: "LATE", heard: heard(1) }], altitude_unit: "m" });
            await settle(element);
            expect(rows(root)).toHaveLength(0);

            // With the first receiver's reading done, the second one is read.
            await vi.advanceTimersByTimeAsync(1_000);
            await settle(element);
            expect(calls.at(-1)).toMatchObject({ service_data: { device: "receiver0002" } });
            expect(rows(root).map((row) => text(row.querySelector(".callsign")))).toEqual(["BRAVO"]);
        });

        // While the list slides, it doesn't scroll, so a held card shows no scrollbar as it grows. The fold's own slide ends it,
        // or a second later, as under reduced motion there is no slide to end.
        it("doesn't scroll while it slides", async () => {
            const { element, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }], {});
            const sliding = () => !!root.querySelector(".aircraft.sliding");
            const fold = () => root.querySelector(".aircraft .fold")!;
            expect(sliding()).toBe(false);
            heading(root)!.click();
            await element.updateComplete;
            expect(sliding()).toBe(true);
            fold()
                .querySelector(".fold-in")!
                .dispatchEvent(Object.assign(new Event("transitionend", { bubbles: true }), { propertyName: "grid-template-rows" }));
            fold().dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "opacity" }));
            await element.updateComplete;
            expect(sliding()).toBe(true);
            fold().dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "grid-template-rows" }));
            await element.updateComplete;
            expect(sliding()).toBe(false);

            vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
            heading(root)!.click();
            await element.updateComplete;
            expect(sliding()).toBe(true);
            // A slide takes a quarter of a second, so the fallback mustn't end it early.
            await vi.advanceTimersByTimeAsync(999);
            await element.updateComplete;
            expect(sliding()).toBe(true);
            await vi.advanceTimersByTimeAsync(1);
            await element.updateComplete;
            expect(sliding()).toBe(false);
        });

        it("leaves no slide behind when the card leaves the page while its list slides", async () => {
            const { element, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }], {});
            heading(root)!.click();
            await element.updateComplete;
            expect(root.querySelector(".aircraft.sliding")).not.toBeNull();
            element.remove();
            document.body.append(element);
            await element.updateComplete;
            expect(root.querySelector(".aircraft.sliding")).toBeNull();
        });

        it("never reads twice at a time", async () => {
            const { calls } = await withList(["pending"]);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(calls).toHaveLength(1);
        });

        it("shows its ages as they are the moment the card comes back to the page", async () => {
            const { element, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }, "pending"]);
            element.remove();
            await vi.advanceTimersByTimeAsync(300_000);
            // Back, before any tick and with the next answer still on the way: heard 301 s ago.
            document.body.append(element);
            await element.updateComplete;
            expect(text(root.querySelector(".plane .sub"))).toBe("556 km/h · 5 min");
        });

        it("stops reading when the card leaves the page, and keeps a list shut by hand shut when it comes back", async () => {
            const { element, calls, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }]);
            expect(calls).toHaveLength(1);
            element.remove();
            await vi.advanceTimersByTimeAsync(30_000);
            expect(calls).toHaveLength(1);

            // Back on the page, as Home Assistant puts a cached view back, it reads again.
            document.body.append(element);
            await settle(element);
            expect(calls).toHaveLength(2);

            heading(root)!.click();
            await settle(element);
            element.remove();
            document.body.append(element);
            await settle(element);
            await vi.advanceTimersByTimeAsync(20_000);
            expect(isOpen(root)).toBe(false);
            expect(calls).toHaveLength(2);
        });

        // A new configuration opens or shuts the list only when its own list_open changed, and another receiver's list is
        // dropped at once rather than shown under this receiver's name.
        it("follows a new configuration", async () => {
            const answers: Answer[] = [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }];
            const { element, calls, root, state } = await withList(answers, {});
            heading(root)!.click();
            await settle(element);
            expect(calls).toHaveLength(1);

            // The same settings again: the list opened by hand stays open and goes on being read.
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER } as AdsbReceiverCardConfig);
            await settle(element);
            expect(isOpen(root)).toBe(true);

            // list_open: false is what no list_open meant, so it changes nothing either, and nothing slides.
            const sliding = () => !!root.querySelector(".aircraft.sliding");
            root.querySelector(".aircraft .fold")!.dispatchEvent(
                Object.assign(new Event("transitionend"), { propertyName: "grid-template-rows" }),
            );
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, list_open: false } as AdsbReceiverCardConfig);
            await settle(element);
            expect(isOpen(root)).toBe(true);
            expect(sliding()).toBe(false);

            // list_open itself changed to false: the list shuts and isn't read any more.
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, list_open: true } as AdsbReceiverCardConfig);
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, list_open: false } as AdsbReceiverCardConfig);
            await settle(element);
            expect(isOpen(root)).toBe(false);
            expect(sliding()).toBe(true);
            const shut = calls.length;
            await vi.advanceTimersByTimeAsync(20_000);
            expect(calls).toHaveLength(shut);

            // list_open changed to true: the list slides open and is read.
            root.querySelector(".aircraft .fold")!.dispatchEvent(
                Object.assign(new Event("transitionend"), { propertyName: "grid-template-rows" }),
            );
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, list_open: true } as AdsbReceiverCardConfig);
            await settle(element);
            expect(isOpen(root)).toBe(true);
            expect(sliding()).toBe(true);
            expect(calls.length).toBeGreaterThan(shut);

            // Another receiver: the first one's aircraft go at once, while the second's are on the way.
            state.entities!["sensor.second_positions"] = {
                entity_id: "sensor.second_positions",
                device_id: "receiver0002",
                platform: "adsb_live",
                translation_key: "positions_per_minute",
            };
            state.states["sensor.second_positions"] = entity("sensor.second_positions", "0");
            state.devices!["receiver0002"] = { id: "receiver0002", name: "Toinen", manufacturer: "readsb" };
            element.hass = { ...state };
            answers.push("pending");
            element.setConfig({ type: "custom:adsb-receiver-card", device: "receiver0002", list_open: true } as AdsbReceiverCardConfig);
            await settle(element);
            expect(text(root.querySelector(".top .name"))).toBe("Toinen");
            expect(rows(root)).toHaveLength(0);
            expect(text(heading(root))).toBe("Kuultavat koneet");
        });

        it("isn't there without ADS-B Live's action, as with a version from before it", async () => {
            const state = hass();
            state.services = { adsb_live: { get_aircraft_details: {} } };
            const element = await card(state, { list_open: true });
            expect(element.shadowRoot!.querySelector(".aircraft")).toBeNull();
        });

        // What the list says in each answer, and after an answer that fails once the list has been read.
        describe("the list in each answer", () => {
            it.each([
                { answers: ["pending"], heading: "Kuultavat koneet", shown: [], message: "" },
                { answers: ["failed"], heading: "Kuultavat koneet", shown: [], message: "Koneita ei saatu luettua" },
                {
                    answers: [{ aircraft: [], altitude_unit: "m" }],
                    heading: "Kuultavat koneet 0",
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                    heading: "Kuultavat koneet 1",
                    shown: ["EXA123"],
                    sub: "556 km/h · nyt",
                    message: "",
                },
                {
                    answers: ["failed", { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                    heading: "Kuultavat koneet 1",
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }, "pending"],
                    heading: "Kuultavat koneet 1",
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: [
                        { aircraft: [], altitude_unit: "m" },
                        { aircraft: [], altitude_unit: "m" },
                    ],
                    heading: "Kuultavat koneet 0",
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                    ],
                    heading: "Kuultavat koneet 1",
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: ["failed", { aircraft: [], altitude_unit: "m" }],
                    heading: "Kuultavat koneet 0",
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                { answers: ["failed", "failed"], heading: "Kuultavat koneet", shown: [], message: "Koneita ei saatu luettua" },
                { answers: ["failed", "pending"], heading: "Kuultavat koneet", shown: [], message: "Koneita ei saatu luettua" },
                // An empty answer is an answer: a failure after it keeps it.
                {
                    answers: [{ aircraft: [], altitude_unit: "m" }, "failed"],
                    heading: "Kuultavat koneet 0",
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [{ aircraft: [], altitude_unit: "m" }, "pending"],
                    heading: "Kuultavat koneet 0",
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [
                        { aircraft: [], altitude_unit: "m" },
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                    ],
                    heading: "Kuultavat koneet 1",
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: [
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                        "failed",
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                    ],
                    heading: "Kuultavat koneet 1",
                    shown: ["EXA123"],
                    sub: "556 km/h · 21 s",
                    message: "",
                },
                // Kept after the failure, its age goes on counting up from the answer: 1 s then, 11 s now.
                {
                    answers: [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }, "failed"],
                    heading: "Kuultavat koneet 1",
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: [
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                        { aircraft: [], altitude_unit: "m" },
                    ],
                    heading: "Kuultavat koneet 0",
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
            ] as Array<{ answers: Answer[]; heading: string; shown: string[]; sub?: string; message: string }>)(
                "shows $shown and says '$message' after the answers $answers",
                async ({ answers, heading: title, shown, sub, message }) => {
                    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
                    const { element, root } = await withList(answers);
                    for (let refresh = 1; refresh < answers.length; refresh++) {
                        await vi.advanceTimersByTimeAsync(10_000);
                    }
                    await settle(element);
                    expect(text(heading(root))).toBe(title);
                    expect(rows(root).map((row) => text(row.querySelector(".callsign")))).toEqual(shown);
                    if (sub) {
                        expect(text(root.querySelector(".plane .sub"))).toBe(sub);
                    }
                    expect(text(root.querySelector(".aircraft .message"))).toBe(message);
                    warn.mockRestore();
                },
            );
        });

        // Each aircraft's row: its name and type, its altitude in the receiver's unit, its ground speed and when it was last
        // heard, its signal on the meter's scale, and dimmed without a position.
        describe("each aircraft's row", () => {
            it.each([
                {
                    case: "everything",
                    plane: PLANE,
                    at: 1,
                    name: "EXA123 A320",
                    altitude: "3 658 m",
                    sub: "556 km/h · nyt",
                    signal: "83.2%",
                },
                { case: "feet", plane: { ...PLANE, altitude: 12000 }, unit: "ft", altitude: "12 000 ft" },
                { case: "on the ground", plane: { ...PLANE, altitude: undefined, on_ground: true }, altitude: "maassa" },
                { case: "no altitude", plane: { ...PLANE, altitude: undefined }, altitude: "–" },
                { case: "no type", plane: { ...PLANE, type: undefined }, name: "EXA123" },
                { case: "no speed", plane: { ...PLANE, speed_kmh: undefined }, sub: "nyt" },
                { case: "no signal", plane: { ...PLANE, rssi: undefined }, signal: null },
                { case: "a signal past the meter's end", plane: { ...PLANE, rssi: -61 }, signal: "0%" },
                { case: "no position", plane: { ...PLANE, position: false }, dimmed: true },
                { case: "heard just under 2 s ago", at: 1.9, sub: "556 km/h · nyt" },
                { case: "heard 2 s ago", at: 2, sub: "556 km/h · 2 s" },
                { case: "heard 59 s ago", at: 59.9, sub: "556 km/h · 59 s" },
                { case: "heard a minute ago", at: 60, sub: "556 km/h · 1 min" },
                { case: "heard over 2 minutes ago", at: 125, sub: "556 km/h · 2 min" },
            ] as Array<{
                case: string;
                plane?: Record<string, unknown>;
                unit?: string;
                at?: number;
                name?: string;
                altitude?: string;
                sub?: string;
                signal?: string | null;
                dimmed?: boolean;
            }>)("is written so with $case", async (row) => {
                const plane = { ...(row.plane ?? PLANE), heard: heard(row.at ?? 1) };
                const { root } = await withList([{ aircraft: [plane], altitude_unit: row.unit ?? "m" }]);
                const [drawn] = rows(root);
                expect(text(drawn.querySelector(".id"))).toBe(row.name ?? "EXA123 A320");
                expect(text(drawn.querySelector(".altitude"))).toBe(row.altitude ?? "3 658 m");
                expect(text(drawn.querySelector(".sub"))).toBe(row.sub ?? "556 km/h · nyt");
                const fill = drawn.querySelector<HTMLElement>(".signal i");
                expect(fill ? fill.style.width : null).toBe(row.signal === undefined ? "83.2%" : row.signal);
                expect(drawn.classList.contains("nopos")).toBe(row.dimmed ?? false);
                // After the type, or the name without one, an icon says whether the aircraft's position is known.
                const located = !(row.dimmed ?? false);
                const icon = drawn.querySelector(".id .position");
                expect(icon?.getAttribute("icon")).toBe(located ? "mdi:crosshairs-gps" : "mdi:crosshairs-question");
                expect(icon?.getAttribute("aria-label")).toBe(located ? "Sijainti tiedossa" : "Ei sijaintia");
                expect(icon?.getAttribute("title")).toBe(icon?.getAttribute("aria-label"));
            });
        });

        // The card's own classes style whatever carries them, as the receiver's name once made each callsign as large as it.
        it("gives its rows none of the card's own classes", async () => {
            const { root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }]);
            expect(rows(root)).toHaveLength(1);
            expect([...root.querySelectorAll(".name")].map(text)).toEqual(["ADS-B"]);
            expect(root.querySelector(".plane .status, .plane .value, .plane .label, .plane .figure")).toBeNull();
        });

        it("counts each row's age up on its own between the readings", async () => {
            const { element, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }]);
            expect(text(root.querySelector(".plane .sub"))).toBe("556 km/h · nyt");
            await vi.advanceTimersByTimeAsync(3_000);
            await settle(element);
            expect(text(root.querySelector(".plane .sub"))).toBe("556 km/h · 4 s");
        });

        it("puts the aircraft heard last first, and those heard at once by name", async () => {
            const { root } = await withList([
                {
                    aircraft: [
                        { ...PLANE, hex: "1", name: "OLD", heard: heard(30) },
                        { ...PLANE, hex: "2", name: "NEW", heard: heard(1) },
                        { ...PLANE, hex: "3", name: "BETA", heard: heard(10) },
                        { ...PLANE, hex: "4", name: "ALFA", heard: heard(10) },
                    ],
                    altitude_unit: "m",
                },
            ]);
            expect(rows(root).map((row) => text(row.querySelector(".callsign")))).toEqual(["NEW", "ALFA", "BETA", "OLD"]);
        });

        // A sections view's rows set the height when they are a number. Otherwise max_height is the most the card grows to,
        // and only the list scrolls inside it.
        describe("the card's height", () => {
            it.each([
                { layout: undefined, rows: undefined, max_height: undefined, style: "" },
                { layout: undefined, rows: undefined, max_height: 300, style: "max-height: 300px;" },
                { layout: "grid", rows: 6, max_height: 300, style: "height: 100%;" },
                { layout: "grid", rows: 6, max_height: undefined, style: "height: 100%;" },
                { layout: "grid", rows: "auto", max_height: 300, style: "max-height: 300px;" },
                { layout: "grid", rows: undefined, max_height: undefined, style: "" },
                { layout: "grid", rows: undefined, max_height: 300, style: "max-height: 300px;" },
                { layout: "grid", rows: "auto", max_height: undefined, style: "" },
                // Rows left in the configuration from a sections view mean nothing elsewhere.
                { layout: undefined, rows: 6, max_height: 300, style: "max-height: 300px;" },
                { layout: undefined, rows: 6, max_height: undefined, style: "" },
                { layout: undefined, rows: "auto", max_height: 300, style: "max-height: 300px;" },
                { layout: undefined, rows: "auto", max_height: undefined, style: "" },
            ])(
                "is '$style' in the layout $layout with rows $rows and max_height $max_height",
                async ({ layout, rows: gridRows, max_height, style }) => {
                    const element = document.createElement("adsb-receiver-card");
                    element.setConfig({
                        type: "custom:adsb-receiver-card",
                        device: RECEIVER,
                        ...(max_height === undefined ? {} : { max_height }),
                        ...(gridRows === undefined ? {} : { grid_options: { rows: gridRows } }),
                    } as AdsbReceiverCardConfig);
                    (element as unknown as { layout?: string }).layout = layout;
                    element.hass = hass();
                    document.body.append(element);
                    await element.updateComplete;
                    const drawn = element.shadowRoot!.querySelector("ha-card")!;
                    expect(drawn.getAttribute("style") ?? "").toBe(style);
                    expect(drawn.classList.contains("held")).toBe(style !== "");
                },
            );
        });

        describe("a max_height that isn't a number of pixels", () => {
            it.each([{ max_height: 0 }, { max_height: -10 }, { max_height: "300px" }, { max_height: Number.NaN }])(
                "is refused: $max_height",
                ({ max_height }) => {
                    const element = document.createElement("adsb-receiver-card");
                    expect(() =>
                        element.setConfig({
                            type: "custom:adsb-receiver-card",
                            device: RECEIVER,
                            max_height,
                        } as unknown as AdsbReceiverCardConfig),
                    ).toThrow("Invalid configuration");
                },
            );
        });
    });

    it("refuses a configuration without a receiver", () => {
        const element = document.createElement("adsb-receiver-card");
        expect(() => element.setConfig({ type: "custom:adsb-receiver-card" } as AdsbReceiverCardConfig)).toThrow("Invalid configuration");
    });
});

function withState(state: HomeAssistant, id: string, value: string): HomeAssistant {
    return { ...state, states: { ...state.states, [id]: entity(id, value) } };
}

describe("the editor", () => {
    // The defaults and empty fields are shown in the form but left out of what it saves.
    describe("what the editor saves", () => {
        it.each([
            {
                case: "the default layout and empty fields",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, layout: "full", name: "", feeders: [] },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "no layout at all",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "the compact layout and a name",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, layout: "compact", name: "Katto" },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER, layout: "compact", name: "Katto" },
            },
            {
                case: "the list closed and no height",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, list_open: false, max_height: undefined },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "the list open and a height",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, list_open: true, max_height: 480 },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER, list_open: true, max_height: 480 },
            },
            {
                case: "a feeder with empty fields",
                form: {
                    type: "custom:adsb-receiver-card",
                    device: RECEIVER,
                    feeders: [{ entity: "binary_sensor.fr24_link", name: "", detail: "" }],
                },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER, feeders: [{ entity: "binary_sensor.fr24_link" }] },
            },
        ])("saves $case as only what is set", async ({ form, saved }) => {
            const editor = document.createElement("adsb-receiver-card-editor");
            const configs: unknown[] = [];
            editor.addEventListener("config-changed", (event) => configs.push((event as CustomEvent<{ config: unknown }>).detail.config));
            (editor as unknown as { valueChanged(event: CustomEvent): void }).valueChanged(
                new CustomEvent("value-changed", { detail: { value: form } }),
            );
            expect(configs).toEqual([saved]);
        });
    });

    it("keeps only what is filled in for a feeder, and drops a feeder without its entity", () => {
        expect(
            compactFeeders([
                { entity: "binary_sensor.fr24_link", name: "", detail: "sensor.fr24_reported" },
                { entity: "", name: "Empty" },
            ]),
        ).toEqual([{ entity: "binary_sensor.fr24_link", detail: "sensor.fr24_reported" }]);
    });
});
