import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../src/adsb-receiver-card";
import type { AdsbReceiverCard } from "../src/adsb-receiver-card";
import { HISTORY_REFRESH_MS } from "../src/const";
import { compactFeeders } from "../src/editor";
import type { HomeAssistant } from "../src/hass";
import type { AdsbReceiverCardConfig } from "../src/types";
import { RECEIVER, SENSOR_IDS, entity, hass } from "./fixtures";

const NOW = Date.parse("2026-10-14T07:40:00Z");

async function card(state: HomeAssistant, config: Partial<AdsbReceiverCardConfig> = {}, layout?: string): Promise<AdsbReceiverCard> {
    const element = document.createElement("adsb-receiver-card");
    element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...config } as AdsbReceiverCardConfig);
    element.layout = layout;
    element.hass = state;
    document.body.append(element);
    await element.updateComplete;
    return element;
}

/** Picks the feeders' tab, which the aircraft's has ahead of it while the receiver has its list and no feeder a problem. */
async function feeders(element: AdsbReceiverCard): Promise<ShadowRoot> {
    const tab = [...element.shadowRoot!.querySelectorAll<HTMLElement>(".tab")].find((one) => one.textContent?.includes("Syötteet"));
    tab?.click();
    await element.updateComplete;
    return element.shadowRoot!;
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
        const root = await feeders(element);
        expect(root.querySelector("ha-card")?.classList.contains("receiving")).toBe(true);
        expect(text(root.querySelector(".name"))).toBe("ADS-B");
        expect(text(root.querySelector(".status"))).toBe("Kuulee");
        expect(text(root.querySelector(".line"))).toBe("Kuulee · 184,6 viestiä/s · 142 sijaintia/min");
        expect(text(root.querySelector(".version"))).toBe("readsb 3.16.17");
        expect([...root.querySelectorAll(".figure")].map(text)).toEqual(["7 seurannassa", "5 sijainnilla", "138 km kantama, 15 min"]);
        // Each level carries its short name too, which only a narrow card shows.
        expect(text(root.querySelector(".levels"))).toBe("KohinaK −39,6 dBFS SignaaliS −18,2 dBFS");
        expect(text(root.querySelector(".feeder"))).toBe("Flightradar24 Yhdistetty, 5 lentoalusta");
        expect(root.querySelector(".feeder .dot")?.classList.contains("ok")).toBe(true);
    });

    it("writes one position a minute in the singular", async () => {
        const element = await card(hass({ positions_per_minute: "1" }));
        expect(text(element.shadowRoot!.querySelector(".line"))).toBe("Kuulee · 184,6 viestiä/s · 1 sijainti/min");
    });

    it("is quiet in grey when nothing comes with a position", async () => {
        const element = await card(hass({ positions_per_minute: "0", aircraft_with_position: "0", aircraft_tracked: "1" }));
        const root = element.shadowRoot!;
        expect(root.querySelector("ha-card")?.classList.contains("quiet")).toBe(true);
        expect(text(root.querySelector(".status"))).toBe("Hiljaista");
        expect(text(root.querySelector(".figure"))).toBe("1 seurannassa");
    });

    // What each layout shows in each status. An unavailable receiver keeps only what doesn't come from its sensors: its name
    // and status, and in the full layout its version and the feeders' rows, alone without the aircraft, so under no tabs.
    const PARTS = [".version", ".figures", ".curve", ".meter", ".tabs", ".row .line", ".small-curve"];
    describe("each layout in each status", () => {
        const FULL = [".version", ".figures", ".curve", ".meter", ".tabs"];
        const COMPACT = [".row .line", ".small-curve"];
        const BOTH = ["Kuultavat koneet", "Syötteet"];
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
            { layout: "full", positions: "receiving", status: "Kuulee", shown: FULL, tabs: BOTH },
            { layout: "full", positions: "quiet", status: "Hiljaista", shown: FULL, tabs: BOTH },
            { layout: "full", positions: "all unavailable", status: "Ei saatavilla", shown: [".version"], tabs: [] },
            { layout: "full", positions: "only it unavailable", status: "Ei saatavilla", shown: [".version"], tabs: [] },
            { layout: "full", positions: "missing", status: "Ei saatavilla", shown: [".version"], tabs: [] },
            { layout: "full", positions: "without a state", status: "Ei saatavilla", shown: [".version"], tabs: [] },
            // Without noise the meter has nothing to compare with, so it is left out.
            {
                layout: "full",
                positions: "only it receiving",
                status: "Kuulee",
                shown: [".version", ".figures", ".curve", ".tabs"],
                tabs: BOTH,
            },
            { layout: "compact", positions: "receiving", status: "Kuulee", shown: COMPACT, tabs: [] },
            { layout: "compact", positions: "quiet", status: "Hiljaista", shown: COMPACT, tabs: [] },
            { layout: "compact", positions: "all unavailable", status: "Ei saatavilla", shown: [], tabs: [] },
            { layout: "compact", positions: "only it unavailable", status: "Ei saatavilla", shown: [], tabs: [] },
            { layout: "compact", positions: "missing", status: "Ei saatavilla", shown: [], tabs: [] },
            { layout: "compact", positions: "without a state", status: "Ei saatavilla", shown: [], tabs: [] },
            { layout: "compact", positions: "only it receiving", status: "Kuulee", shown: COMPACT, tabs: [] },
        ])(
            "in the $layout layout with positions $positions shows $shown and the tabs $tabs",
            async ({ layout, positions, status, shown, tabs }) => {
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
                expect([...root.querySelectorAll(".tab .label:not(.short)")].map(text)).toEqual(tabs);
                if (shown.includes(".version")) {
                    expect(text(root.querySelector(".version"))).toBe("readsb 3.16.17");
                }
            },
        );
    });

    // The dot of the present value alone means the recorder has no hour yet, so the curve waits for the recorder's answer.
    // A refresh that fails keeps the curve the card has, and one that answers replaces it.
    describe("the curve before and after its statistics", () => {
        const NOTHING = { full: "", small: "", lone: false, peak: "" };
        const LONE = { full: "M360.0,18.0L360.0,18.0", small: "M90.0,16.0L90.0,16.0", lone: true, peak: "huippu 2" };
        const HOUR = { full: "M180.0,1.0L360.0,18.0", small: "M45.0,1.0L90.0,16.0", lone: false, peak: "huippu 4" };
        it.each([
            { answers: ["pending"], ...NOTHING },
            { answers: ["failed"], ...NOTHING },
            { answers: ["no hours"], ...LONE },
            { answers: ["an hour"], ...HOUR },
            // The full layout's kept hour moves left with the clock, as the aircraft's ticks draw it again: 10 minutes of 24
            // hours later, 2.5 px of 360. The compact layout has no aircraft, so nothing draws it again.
            { answers: ["an hour", "failed"], ...HOUR, full: "M177.5,1.0L360.0,18.0" },
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
        expect(text(element.shadowRoot!.querySelector(".levels"))).toBe("KohinaK −39,6 dBFS Signaali ei tiedossa");
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
            expect(text((await feeders(element)).querySelector(".feeder"))).toBe(row);
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

    it.each<[string, Partial<AdsbReceiverCardConfig>, string]>([
        ["the full layout's height", {}, "height: 400px"],
        ["no height in the compact layout", { layout: "compact" }, ""],
    ])("keeps to %s when it says the receiver is missing", async (_name, extra, style) => {
        const element = await card(hass(), { device: "nothing0001", height: 400, ...extra });
        expect(element.shadowRoot!.querySelector("ha-card")!.getAttribute("style") ?? "").toBe(style);
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
        expect(element.shadowRoot!.querySelector(".curve path")?.getAttribute("d")).toBe("M15.0,35.0L180.0,12.3L360.0,23.7");
        expect(element.shadowRoot!.querySelector(".curve path")?.classList.contains("lone")).toBe(false);
    });

    // Pointing at the curve shows the point nearest the pointer: an hour's mean, named by the hour's start in the viewer's
    // format, or the present value at the end, its tooltip kept inside the card at either end.
    describe("the curve's tooltip", () => {
        async function pointed(): Promise<AdsbReceiverCard> {
            const state = hass({ aircraft_tracked: "2" });
            state.services = { adsb_live: { get_aircraft_details: {} } };
            state.callWS = (async () => ({
                [SENSOR_IDS.aircraft_tracked]: [
                    // 08.00 and 19.00 UTC the day before, the means drawn at the middle of their hours.
                    { start: Date.parse("2026-10-13T08:00:00Z"), mean: 1, max: 1 },
                    { start: Date.parse("2026-10-13T19:00:00Z"), mean: 4.5, max: 6 },
                    { start: Date.parse("2026-10-14T02:00:00Z"), mean: 3, max: 3 },
                ],
            })) as HomeAssistant["callWS"];
            const element = await card(state);
            await vi.waitFor(() => expect(element.shadowRoot!.querySelector(".curve path")?.getAttribute("d")).not.toBe(""));
            const plot = element.shadowRoot!.querySelector<HTMLElement>(".plot")!;
            plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 36 }) as DOMRect;
            return element;
        }

        async function point(element: AdsbReceiverCard, clientX: number): Promise<HTMLElement | null> {
            element.shadowRoot!.querySelector(".curve")!.dispatchEvent(new MouseEvent("pointermove", { clientX, bubbles: true }));
            await element.updateComplete;
            return element.shadowRoot!.querySelector<HTMLElement>(".tip");
        }

        // The window starts at 07.40 UTC the day before, 24 hours before now: 08.30 is at 12.5 px of 360, 19.30 at 177.5,
        // 02.30 at 282.5, past three quarters.
        it.each([
            ["an hour's mean near the start, kept inside the card", 5, "klo 8.00 · keskimäärin 1 seurannassa", "start"],
            ["an hour's mean with a decimal in the middle", 180, "klo 19.00 · keskimäärin 4,5 seurannassa", ""],
            ["an hour's mean past three quarters, kept inside the card", 282, "klo 2.00 · keskimäärin 3 seurannassa", "end"],
            ["the present value at the end, kept inside the card", 358, "nyt · 2 seurannassa", "end"],
        ])("shows %s", async (_name, x, tip, align) => {
            const shown = await point(await pointed(), x);
            expect(text(shown)).toBe(tip);
            expect(["start", "end"].filter((name) => shown!.classList.contains(name))).toEqual(align ? [align] : []);
        });

        // A curve taken off the card gets no pointerleave, so the tooltip mustn't come back with it.
        it("goes when the curve is taken off the card, and doesn't come back with it", async () => {
            const element = await pointed();
            expect(await point(element, 180)).not.toBeNull();
            const state = element.hass!;
            const positions = (value: string) => ({
                ...state,
                states: { ...state.states, [SENSOR_IDS.positions_per_minute]: entity(SENSOR_IDS.positions_per_minute, value) },
            });
            element.hass = positions("unavailable");
            await element.updateComplete;
            expect(element.shadowRoot!.querySelector(".curve")).toBeNull();
            element.hass = positions("142");
            await element.updateComplete;
            expect(element.shadowRoot!.querySelector(".curve")).not.toBeNull();
            expect(element.shadowRoot!.querySelector(".tip")).toBeNull();
            expect(element.shadowRoot!.querySelector(".plot .dot")).toBeNull();
        });

        // Home Assistant puts a cached view back with its cards, and a card taken off the page gets no pointerleave either.
        it("goes when the card leaves the page, and doesn't come back with it", async () => {
            const element = await pointed();
            expect(await point(element, 180)).not.toBeNull();
            element.remove();
            document.body.append(element);
            await element.updateComplete;
            expect(element.shadowRoot!.querySelector(".curve")).not.toBeNull();
            expect(element.shadowRoot!.querySelector(".tip")).toBeNull();
            expect(element.shadowRoot!.querySelector(".plot .dot")).toBeNull();
        });

        it("goes when the pointer leaves the curve", async () => {
            const element = await pointed();
            expect(await point(element, 180)).not.toBeNull();
            element.shadowRoot!.querySelector(".curve")!.dispatchEvent(new MouseEvent("pointerleave"));
            await element.updateComplete;
            expect(element.shadowRoot!.querySelector(".tip")).toBeNull();
        });
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
            config: Partial<AdsbReceiverCardConfig> = {},
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

        /** The tab named so, and whether its pane is shown. */
        const tab = (root: ShadowRoot, name: string) =>
            [...root.querySelectorAll<HTMLElement>(".tab")].find((one) => one.querySelector(".label")?.textContent === name);
        const shown = (root: ShadowRoot) => [...root.querySelectorAll(".tab.on .label:not(.short)")].map(text);
        const AIRCRAFT = "Kuultavat koneet";
        const FEEDER_TAB = "Syötteet";
        const withFeeders = (state: HomeAssistant) => {
            for (const feeder of FEEDERS) {
                state.states[feeder.entity_id] = feeder;
            }
        };

        async function settle(element: AdsbReceiverCard): Promise<void> {
            await new Promise((resolve) => setTimeout(resolve, 0));
            await element.updateComplete;
        }

        const rows = (root: ShadowRoot) => [...root.querySelectorAll(".plane")];

        it("is shown first and read every 10 seconds, until the feeders' tab is picked, and again when its own is", async () => {
            const { element, calls, root } = await withList(
                [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                { feeders: [{ entity: "binary_sensor.fr24_link" }] },
                withFeeders,
            );
            expect(shown(root)).toEqual([AIRCRAFT]);
            expect(calls).toEqual([
                {
                    type: "call_service",
                    domain: "adsb_live",
                    service: "get_receiver_aircraft",
                    service_data: { device: RECEIVER },
                    return_response: true,
                },
            ]);
            expect(rows(root)).toHaveLength(1);
            // Shown, the tab counts the rows it shows, not the aircraft tracked (7), which count another window.
            expect(text(tab(root, AIRCRAFT)?.querySelector(".count"))).toBe("1");
            expect(text(tab(root, FEEDER_TAB)?.querySelector(".count"))).toBe("1");

            await vi.advanceTimersByTimeAsync(9_000);
            expect(calls).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(calls).toHaveLength(2);

            tab(root, FEEDER_TAB)!.click();
            await settle(element);
            expect(shown(root)).toEqual([FEEDER_TAB]);
            expect(rows(root)).toHaveLength(0);
            // Not read while hidden, the aircraft's tab counts the aircraft tracked instead.
            expect(text(tab(root, AIRCRAFT)?.querySelector(".count"))).toBe("7");
            expect(root.querySelectorAll(".pane .feeder")).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(calls).toHaveLength(2);

            tab(root, AIRCRAFT)!.click();
            await settle(element);
            expect(calls).toHaveLength(3);
            expect(rows(root)).toHaveLength(1);
        });

        // The feeders' pane opens by itself while a feeder has a problem, with a mark on its tab, until a tab is picked.
        describe("the feeders' problems", () => {
            it.each([
                { feeder: "connected", state: "on", problem: false },
                { feeder: "disconnected", state: "off", problem: true },
                { feeder: "unavailable", state: "unavailable", problem: true },
                { feeder: "missing", state: undefined, problem: true },
                // A state that says neither up nor down, as a sensor's count or Home Assistant's own unknown, is no problem.
                { feeder: "of a sensor with a count", state: "5", entity: "sensor.fr24_reported", problem: false },
                { feeder: "in Home Assistant's unknown state", state: "unknown", problem: false },
                // A problem sensor reads the other way round: on is the problem.
                { feeder: "of a problem sensor that is on", state: "on", entity: "binary_sensor.fr24_fault", problem: true },
                { feeder: "of a problem sensor that is off", state: "off", entity: "binary_sensor.fr24_fault", problem: false },
            ])("open the feeders first and mark their tab with one $feeder: $problem", async ({ state: value, entity: id, problem }) => {
                const entityId = id ?? "binary_sensor.fr24_link";
                const { root } = await withList([{ aircraft: [], altitude_unit: "m" }], { feeders: [{ entity: entityId }] }, (state) => {
                    withFeeders(state);
                    const attributes =
                        entityId === "binary_sensor.fr24_fault" ? { device_class: "problem" } : (state.states[entityId]?.attributes ?? {});
                    if (value === undefined) {
                        delete state.states[entityId];
                    } else {
                        state.states[entityId] = entity(entityId, value, attributes);
                    }
                });
                expect(shown(root)).toEqual([problem ? FEEDER_TAB : AIRCRAFT]);
                const mark = tab(root, FEEDER_TAB)?.querySelector(".problem");
                expect(!!mark).toBe(problem);
                if (mark) {
                    expect(mark.getAttribute("title")).toBe("Syötteessä on ongelma");
                }
            });

            it("are found in any feeder, not only the first", async () => {
                const { root } = await withList(
                    [{ aircraft: [], altitude_unit: "m" }],
                    { feeders: [{ entity: "binary_sensor.fr24_link" }, { entity: "binary_sensor.second_link" }] },
                    (state) => {
                        withFeeders(state);
                        state.states["binary_sensor.second_link"] = entity("binary_sensor.second_link", "off", {
                            device_class: "connectivity",
                        });
                    },
                );
                expect(shown(root)).toEqual([FEEDER_TAB]);
                expect(tab(root, FEEDER_TAB)?.querySelector(".problem")).not.toBeNull();
            });

            it("leave the feeders alone under no tabs, a row's own dot marking it, for an unavailable receiver", async () => {
                const { root } = await withList(
                    [{ aircraft: [], altitude_unit: "m" }],
                    { feeders: [{ entity: "binary_sensor.fr24_link" }] },
                    (state) => {
                        withFeeders(state);
                        state.states["binary_sensor.fr24_link"] = entity("binary_sensor.fr24_link", "off", {
                            device_class: "connectivity",
                        });
                        state.states[SENSOR_IDS.positions_per_minute] = entity(SENSOR_IDS.positions_per_minute, "unavailable");
                    },
                );
                expect(root.querySelector(".tabs")).toBeNull();
                expect(root.querySelector(".pane.alone .feeder .dot")?.classList.contains("error")).toBe(true);
            });

            it("follow a problem that comes and goes, until a tab is picked by hand", async () => {
                const { element, root, state } = await withList(
                    [{ aircraft: [], altitude_unit: "m" }],
                    { feeders: [{ entity: "binary_sensor.fr24_link" }] },
                    withFeeders,
                );
                const link = (value: string) => ({
                    ...state,
                    states: { ...state.states, "binary_sensor.fr24_link": entity("binary_sensor.fr24_link", value) },
                });
                element.hass = link("off");
                await settle(element);
                expect(shown(root)).toEqual([FEEDER_TAB]);
                element.hass = link("on");
                await settle(element);
                expect(shown(root)).toEqual([AIRCRAFT]);

                tab(root, AIRCRAFT)!.click();
                element.hass = link("off");
                await settle(element);
                expect(shown(root)).toEqual([AIRCRAFT]);
                expect(tab(root, FEEDER_TAB)?.querySelector(".problem")).not.toBeNull();
            });
        });

        // Read only while the list is on screen: shown, in the full layout, of a receiver that isn't unavailable, with the
        // action there. Otherwise nothing is read.
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
                        { layout: layout as AdsbReceiverCardConfig["layout"] },
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
            const { element, state, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }, "pending"]);
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
            const { element, calls, state, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }]);
            expect(calls).toHaveLength(1);
            const positions = (value: string) => ({
                ...state,
                states: { ...state.states, [SENSOR_IDS.positions_per_minute]: entity(SENSOR_IDS.positions_per_minute, value) },
            });
            element.hass = positions("unavailable");
            await vi.advanceTimersByTimeAsync(30_000);
            expect(calls).toHaveLength(1);
            expect(root.querySelector(".planes")).toBeNull();
            expect(tab(root, AIRCRAFT)).toBeUndefined();

            element.hass = positions("142");
            await settle(element);
            expect(calls).toHaveLength(2);
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
            element.setConfig({ type: "custom:adsb-receiver-card", device: "receiver0002" } as AdsbReceiverCardConfig);
            await settle(element);
            // The first receiver's reading is still on the way, and its list is gone already.
            expect(text(root.querySelector(".top .name"))).toBe("Toinen");
            expect(rows(root)).toHaveLength(0);

            late({ aircraft: [{ ...PLANE, name: "LATE", heard: heard(1) }], altitude_unit: "m" });
            await settle(element);
            expect(rows(root)).toHaveLength(0);

            // With the first receiver's reading done, the second one is read.
            await vi.advanceTimersByTimeAsync(1_000);
            await settle(element);
            expect(calls.at(-1)).toMatchObject({ service_data: { device: "receiver0002" } });
            expect(rows(root).map((row) => text(row.querySelector(".callsign")))).toEqual(["BRAVO"]);
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

        it("stops reading when the card leaves the page, and keeps a tab picked by hand when it comes back or is set up again", async () => {
            const { element, calls, root } = await withList(
                [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                { feeders: [{ entity: "binary_sensor.fr24_link" }] },
                withFeeders,
            );
            expect(calls).toHaveLength(1);
            element.remove();
            await vi.advanceTimersByTimeAsync(30_000);
            expect(calls).toHaveLength(1);

            // Back on the page, as Home Assistant puts a cached view back, it reads again.
            document.body.append(element);
            await settle(element);
            expect(calls).toHaveLength(2);

            tab(root, FEEDER_TAB)!.click();
            await settle(element);
            element.remove();
            document.body.append(element);
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, feeders: [{ entity: "binary_sensor.fr24_link" }] });
            await settle(element);
            await vi.advanceTimersByTimeAsync(20_000);
            expect(shown(root)).toEqual([FEEDER_TAB]);
            expect(calls).toHaveLength(2);
        });

        // Only the pane scrolls, so the list never scrolls inside a card that scrolls too.
        it("puts the top, the figures, the curve, the meter and the tabs ahead of the pane", async () => {
            const { root } = await withList(
                [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                { height: 400, feeders: [{ entity: "binary_sensor.fr24_link" }] },
                withFeeders,
            );
            const haCard = root.querySelector("ha-card")!;
            expect(haCard.classList.contains("held")).toBe(true);
            expect([...haCard.children].map((child) => child.classList[0])).toEqual(["top", "figures", "curve", "meter", "tabs", "pane"]);
            expect([...haCard.querySelector(".pane")!.children].map((child) => child.className)).toEqual(["planes"]);
        });

        type Box = { top: number; bottom: number };

        /** Places the pane's top and the column heads' box where a test has them, as happy-dom lays nothing out. */
        function place(root: ShadowRoot, paneTop: number, head?: Box): HTMLElement {
            const pane = root.querySelector<HTMLElement>("ha-card > .pane")!;
            pane.getBoundingClientRect = () => ({ top: paneTop }) as DOMRect;
            const heads = root.querySelector<HTMLElement>(".plane-head");
            if (heads && head) {
                heads.getBoundingClientRect = () => head as DOMRect;
            }
            pane.dispatchEvent(new Event("scroll"));
            return pane;
        }

        it.each([
            ["stuck at the top", { top: 100, bottom: 120 }, "20px"],
            ["stuck within half a pixel of the top", { top: 100.5, bottom: 120.5 }, "20.5px"],
            ["more than half a pixel below the top", { top: 100.6, bottom: 120.6 }, ""],
            ["pushed half way up by the list's end", { top: 90, bottom: 110 }, "10px"],
            ["pushed fully out by the list's end", { top: 80, bottom: 100 }, ""],
            ["in place below the top", { top: 140, bottom: 160 }, ""],
        ])("has a held card's top fade start under the list's column heads %s", async (_name, head, offset) => {
            const { root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }], { height: 400 });
            expect(place(root, 100, head).style.getPropertyValue("--fade-top-offset")).toBe(offset);
        });

        it("has a held card's top fade start at the pane's top while the feeders are shown", async () => {
            const { element, root } = await withList(
                [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                { height: 400, feeders: [{ entity: "binary_sensor.fr24_link" }] },
                withFeeders,
            );
            expect(place(root, 100, { top: 100, bottom: 120 }).style.getPropertyValue("--fade-top-offset")).toBe("20px");
            tab(root, FEEDER_TAB)!.click();
            await settle(element);
            expect(place(root, 100).style.getPropertyValue("--fade-top-offset")).toBe("");
        });

        it("clears the top fade's offset on the same pane once the column heads move off the top", async () => {
            const { root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }], { height: 400 });
            expect(place(root, 100, { top: 100, bottom: 120 }).style.getPropertyValue("--fade-top-offset")).toBe("20px");
            const pane = place(root, 100, { top: 140, bottom: 160 });
            expect(pane.style.getPropertyValue("--fade-top-offset")).toBe("");
            expect(pane).toBe(root.querySelector("ha-card > .pane"));
        });

        it("clears the top fade's offset when a held card goes to auto", async () => {
            const { element, root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }], { height: 400 });
            const pane = place(root, 100, { top: 100, bottom: 120 });
            expect(pane.style.getPropertyValue("--fade-top-offset")).toBe("20px");
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER } as AdsbReceiverCardConfig);
            await element.updateComplete;
            expect(root.querySelector("ha-card")!.classList.contains("held")).toBe(false);
            expect(root.querySelector("ha-card > .pane")).toBe(pane);
            expect(pane.style.getPropertyValue("--fade-top-offset")).toBe("");
        });

        it("leaves the top fade where it is in the auto mode, column heads or not", async () => {
            const { root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }]);
            expect(place(root, 100, { top: 100, bottom: 120 }).style.getPropertyValue("--fade-top-offset")).toBe("");
        });

        it("is alone under no tabs without feeders, its column heads drawing the tabs' line", async () => {
            const { root } = await withList([{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }]);
            expect(root.querySelector(".tabs")).toBeNull();
            expect(root.querySelector(".pane")?.classList.contains("alone")).toBe(true);
            expect(rows(root)).toHaveLength(1);
        });

        it("isn't there without ADS-B Live's action, as with a version from before it", async () => {
            const state = hass();
            state.services = { adsb_live: { get_aircraft_details: {} } };
            const element = await card(state);
            expect(element.shadowRoot!.querySelector(".tabs")).toBeNull();
            expect(element.shadowRoot!.querySelector(".pane")).toBeNull();
        });

        // What the list says in each answer, and after an answer that fails once the list has been read.
        describe("the list in each answer", () => {
            it.each([
                { answers: ["pending"], shown: [], message: "" },
                { answers: ["failed"], shown: [], message: "Koneita ei saatu luettua" },
                {
                    answers: [{ aircraft: [], altitude_unit: "m" }],
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                    shown: ["EXA123"],
                    sub: "556 km/h · nyt",
                    message: "",
                },
                {
                    answers: ["failed", { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }],
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }, "pending"],
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: [
                        { aircraft: [], altitude_unit: "m" },
                        { aircraft: [], altitude_unit: "m" },
                    ],
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                    ],
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: ["failed", { aircraft: [], altitude_unit: "m" }],
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                { answers: ["failed", "failed"], shown: [], message: "Koneita ei saatu luettua" },
                { answers: ["failed", "pending"], shown: [], message: "Koneita ei saatu luettua" },
                // An empty answer is an answer: a failure after it keeps it.
                {
                    answers: [{ aircraft: [], altitude_unit: "m" }, "failed"],
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [{ aircraft: [], altitude_unit: "m" }, "pending"],
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
                {
                    answers: [
                        { aircraft: [], altitude_unit: "m" },
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                    ],
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
                    shown: ["EXA123"],
                    sub: "556 km/h · 21 s",
                    message: "",
                },
                // Kept after the failure, its age goes on counting up from the answer: 1 s then, 11 s now.
                {
                    answers: [{ aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" }, "failed"],
                    shown: ["EXA123"],
                    sub: "556 km/h · 11 s",
                    message: "",
                },
                {
                    answers: [
                        { aircraft: [{ ...PLANE, heard: heard(1) }], altitude_unit: "m" },
                        { aircraft: [], altitude_unit: "m" },
                    ],
                    shown: [],
                    message: "Viimeisen minuutin aikana ei ole kuultu koneita",
                },
            ] as Array<{ answers: Answer[]; shown: string[]; sub?: string; message: string }>)(
                "shows $shown and says '$message' after the answers $answers",
                async ({ answers, shown, sub, message }) => {
                    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
                    const { element, root } = await withList(answers);
                    for (let refresh = 1; refresh < answers.length; refresh++) {
                        await vi.advanceTimersByTimeAsync(10_000);
                    }
                    await settle(element);
                    expect(rows(root).map((row) => text(row.querySelector(".callsign")))).toEqual(shown);
                    if (sub) {
                        expect(text(root.querySelector(".plane .sub"))).toBe(sub);
                    }
                    expect(text(root.querySelector(".pane .message"))).toBe(message);
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

        // A sections view's rows set the height when they are a number. Otherwise the height mode does, and everything
        // under the tabs scrolls in the pane.
        describe("the card's height", () => {
            it.each<[string, string | undefined, Record<string, unknown>, string]>([
                ["its content", undefined, {}, ""],
                ["a fixed height", undefined, { height_mode: "fixed", height: 400, max_height: 500 }, "height: 400px"],
                ["a maximum height", undefined, { max_height: 500 }, "max-height: 500px"],
                ["its content in the auto mode", undefined, { height_mode: "auto", height: 240 }, ""],
                ["grid rows in a sections view, over its mode", "grid", { height: 240, grid_options: { rows: 6 } }, "height: 100%"],
                ["grid rows in a sections view, with no height", "grid", { grid_options: { rows: 6 } }, "height: 100%"],
                [
                    "its mode when the grid rows are automatic",
                    "grid",
                    { max_height: 500, grid_options: { rows: "auto" } },
                    "max-height: 500px",
                ],
                ["its content in a sections view with no rows", "grid", {}, ""],
                // Rows left in the configuration from a sections view mean nothing elsewhere.
                [
                    "its mode, with rows left from a sections view",
                    undefined,
                    { max_height: 500, grid_options: { rows: 6 } },
                    "max-height: 500px",
                ],
                ["its content, with rows left from a sections view", undefined, { grid_options: { rows: 6 } }, ""],
            ])("sizes itself by %s", async (_name, layout, extra, style) => {
                const element = document.createElement("adsb-receiver-card");
                element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...extra } as AdsbReceiverCardConfig);
                (element as unknown as { layout?: string }).layout = layout;
                element.hass = hass();
                document.body.append(element);
                await element.updateComplete;
                const drawn = element.shadowRoot!.querySelector("ha-card")!;
                expect(drawn.getAttribute("style") ?? "").toBe(style);
                expect(drawn.classList.contains("held")).toBe(style !== "");
            });

            it.each([
                // About six for the fixed part, and four for the pane, or a row for each feeder when more.
                ["its content", {}, 10],
                ["its content with five feeders", { feeders: Array(5).fill({ entity: "binary_sensor.fr24_link" }) }, 11],
                ["a fixed height", { height: 400 }, 8],
                ["a maximum height above its content", { max_height: 1000 }, 10],
                // Raised to the least height, 344 px without feeders.
                ["a maximum height below its content", { max_height: 200 }, 7],
                ["one row in the compact layout, whatever its height", { layout: "compact", height: 400 }, 1],
            ])("sizes itself in a masonry view by %s", (_name, extra, size) => {
                const element = document.createElement("adsb-receiver-card");
                element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...extra } as AdsbReceiverCardConfig);
                expect(element.getCardSize()).toBe(size);
            });

            // Feeders and aircraft only add to what scrolls in the pane. Held, the compact layout is one row at any width.
            it.each<[string, Partial<AdsbReceiverCardConfig>, number]>([
                ["the default", {}, 6],
                ["feeders", { feeders: [{ entity: "binary_sensor.fr24_link" }] }, 6],
                ["the compact layout", { layout: "compact" }, 1],
            ])("keeps to its minimum height in a sections view with %s", (_name, extra, rows) => {
                const element = document.createElement("adsb-receiver-card");
                element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...extra } as AdsbReceiverCardConfig);
                expect(element.getGridOptions().min_rows).toBe(rows);
            });

            it.each([
                ["held to a height", undefined, { height: 300 }, ["fade-bottom"]],
                ["held up to a limit", undefined, { max_height: 300 }, ["fade-bottom"]],
                ["held by rows in a sections view", "grid", { grid_options: { rows: 4 } }, ["fade-bottom"]],
                [
                    "held to a height with automatic rows in a sections view",
                    "grid",
                    { height: 300, grid_options: { rows: "auto" } },
                    ["fade-bottom"],
                ],
                [
                    "held by the older layout options' rows in a sections view",
                    "grid",
                    { layout_options: { grid_rows: 4 } },
                    ["fade-bottom"],
                ],
                ["never in auto", undefined, {}, []],
                ["never in auto with automatic rows in a sections view", "grid", { grid_options: { rows: "auto" } }, []],
                ["never by grid rows outside a sections view", undefined, { grid_options: { rows: 4 } }, []],
            ])("fades the bottom edge of a scroller that runs past it when %s", async (_name, layout, extra, expected) => {
                const element = await card(hass(), extra as Partial<AdsbReceiverCardConfig>, layout);
                const scroll = element.shadowRoot!.querySelector<HTMLElement>("ha-card > .pane")!;
                Object.defineProperty(scroll, "scrollHeight", { value: 600, configurable: true });
                Object.defineProperty(scroll, "clientHeight", { value: 200, configurable: true });
                element.requestUpdate();
                await element.updateComplete;
                expect(["fade-top", "fade-bottom"].filter((name) => scroll.classList.contains(name))).toEqual(expected);
            });

            it("lets go of the scroller's fade when the card goes from held to auto, and fades it again when held again", async () => {
                const element = await card(hass(), { height: 300 });
                const scroll = element.shadowRoot!.querySelector<HTMLElement>("ha-card > .pane")!;
                Object.defineProperty(scroll, "scrollHeight", { value: 600, configurable: true });
                Object.defineProperty(scroll, "clientHeight", { value: 200, configurable: true });
                element.requestUpdate();
                await element.updateComplete;
                expect([...scroll.classList].filter((name) => name.startsWith("fade"))).toEqual(["fades", "fade-bottom"]);
                element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER } as AdsbReceiverCardConfig);
                await element.updateComplete;
                expect([...scroll.classList].filter((name) => name.startsWith("fade"))).toEqual([]);
                element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, height: 300 } as AdsbReceiverCardConfig);
                await element.updateComplete;
                expect([...scroll.classList].filter((name) => name.startsWith("fade"))).toEqual(["fades", "fade-bottom"]);
            });

            it("is held by its rows once moved into a sections view, even when another entity's change comes with it", async () => {
                const state = hass();
                const element = await card(state, { grid_options: { rows: 4 } } as Partial<AdsbReceiverCardConfig>);
                expect(element.shadowRoot!.querySelector("ha-card")!.classList.contains("held")).toBe(false);
                element.layout = "grid";
                element.hass = { ...state, states: { ...state.states, "sensor.unrelated": entity("sensor.unrelated", "1") } };
                await element.updateComplete;
                expect(element.shadowRoot!.querySelector("ha-card")!.classList.contains("held")).toBe(true);
            });

            it("raises a fixed height below its minimum to the minimum", async () => {
                const element = await card(hass(), { height: 100 });
                expect(element.shadowRoot!.querySelector("ha-card")!.getAttribute("style")).toBe("height: 344px");
            });
        });

        describe("a height that isn't a number of pixels, or an unknown height mode", () => {
            it.each([
                { max_height: 0 },
                { max_height: -10 },
                { max_height: "300px" },
                { max_height: Number.NaN },
                { height: 0 },
                { height: "240px" },
                { height_mode: "tall" },
            ])("is refused: %o", (extra) => {
                const element = document.createElement("adsb-receiver-card");
                expect(() =>
                    element.setConfig({
                        type: "custom:adsb-receiver-card",
                        device: RECEIVER,
                        ...extra,
                    } as unknown as AdsbReceiverCardConfig),
                ).toThrow(/^Invalid height\./);
            });
        });

        it("takes a height left empty in YAML as unset", () => {
            const element = document.createElement("adsb-receiver-card");
            const config = { type: "custom:adsb-receiver-card", device: RECEIVER, height_mode: null, height: null, max_height: null };
            expect(() => element.setConfig(config as unknown as AdsbReceiverCardConfig)).not.toThrow();
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
                case: "no height",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, max_height: undefined },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "a height up to a limit",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, height_mode: "max", max_height: 480 },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER, max_height: 480 },
            },
            {
                case: "a list_open left from before the tabs, which the card no longer reads",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, list_open: true },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "the auto height mode shown for a configuration without one",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, height_mode: "auto" },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "a fixed height without the maximum height left from the max mode",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, height_mode: "fixed", height: 300, max_height: 480 },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER, height: 300 },
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
