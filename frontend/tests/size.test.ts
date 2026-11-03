import { afterEach, describe, expect, it, vi } from "vitest";

import "../src/adsb-receiver-card";
import type { AdsbReceiverCard } from "../src/adsb-receiver-card";
import "../src/editor";
import type { AdsbReceiverCardEditor } from "../src/editor";
import type { HomeAssistant } from "../src/hass";
import type { AdsbReceiverCardConfig } from "../src/types";
import { RECEIVER, hass } from "./fixtures";

async function card(config: Partial<AdsbReceiverCardConfig> = {}, layout?: string): Promise<AdsbReceiverCard> {
    const element = document.createElement("adsb-receiver-card");
    element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...config } as AdsbReceiverCardConfig);
    element.layout = layout;
    element.hass = hass();
    document.body.append(element);
    await element.updateComplete;
    return element;
}

function one(element: Element, selector: string): HTMLElement {
    return element.shadowRoot!.querySelector<HTMLElement>(selector)!;
}

// happy-dom lays nothing out, so each part is given the box it would have, measured from the card's top.
function box(target: Element, top: number, bottom: number, width = 300): void {
    target.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, width }) as DOMRect;
}

/**
 * Gives the card its width and height and the full layout's parts their boxes, its pane ending at `end`, fills its rows and
 * returns its style.
 */
async function filled(element: AdsbReceiverCard, end: number, width = 300, height = 56): Promise<string> {
    const haCard = one(element, "ha-card");
    Object.defineProperty(haCard, "clientWidth", { value: width, configurable: true });
    box(haCard, 0, height, width);
    for (const [selector, top, bottom] of [
        [".top", 11, 75],
        [".figures", 75, 139],
        [".curve", 139, 203],
        [".meter", 203, 235],
        [".tabs", 235, 267],
        [".pane", 267, end],
    ] as const) {
        const part = element.shadowRoot!.querySelector(selector);
        if (part) {
            box(part, top, bottom, width);
        }
    }
    (element as unknown as { fillRows(): void }).fillRows();
    await element.updateComplete;
    return one(element, "ha-card").getAttribute("style") ?? "";
}

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
});

describe("filling the rows of a sections view", () => {
    // The content ends 11 px of padding under the pane: at 441 px with it ending at 430.
    it.each([
        ["whole rows, with the spare room under the top", {}, "min-height: 504px; --spare: 63px"],
        ["half rows", { row_step: "half" as const }, "min-height: 472px; --spare: 31px"],
    ])("on automatic rows, ends on %s", async (_name, config, style) => {
        const element = await card(config, "grid");
        expect(await filled(element, 430)).toBe(style);
    });

    // The limit is rounded down to the rows: 600 px to 568. Held, the pane's end reaches 4 px into the card's padding, so
    // a pane ending at 430 is content of 437 px.
    it.each([
        ["under it, on the rows its content needs", 430, "max-height: 568px; min-height: 440px; --spare: 3px"],
        ["over it, on the limit rounded down to the rows", 700, "max-height: 568px; min-height: 568px; --spare: 0px"],
    ])("on automatic rows, grows up to a limit %s", async (_name, end, style) => {
        const element = await card({ max_height: 600 }, "grid");
        expect(await filled(element, end)).toBe(style);
    });

    it("fills the compact layout's rows whatever height mode is left from the full layout", async () => {
        const element = await card({ layout: "compact", max_height: 40 }, "grid");
        box(one(element, ".row"), 0, 60);
        expect(await filled(element, 0)).toBe("min-height: 120px; --spare: 60px");
    });

    it("measures to its last part's end, never an element a theme adds after it", async () => {
        const element = await card({}, "grid");
        const added = document.createElement("div");
        box(added, 0, 900);
        one(element, "ha-card").append(added);
        expect(await filled(element, 430)).toBe("min-height: 504px; --spare: 63px");
    });

    it("doesn't count the spare room it has drawn under the top again", async () => {
        const element = await card({}, "grid");
        one(element, ".top").style.paddingBottom = "63px";
        expect(await filled(element, 493)).toBe("min-height: 504px; --spare: 63px");
    });

    it("fills the compact layout's rows around its one row", async () => {
        const element = await card({ layout: "compact" }, "grid");
        box(one(element, ".row"), 0, 60);
        expect(await filled(element, 0)).toBe("min-height: 120px; --spare: 60px");
        box(one(element, ".row"), 0, 54);
        expect(await filled(element, 0)).toBe("min-height: 56px; --spare: 2px");
    });

    it.each([
        ["outside a sections view", {}, undefined, ""],
        ["in the compact layout on rows set in the layout tab", { layout: "compact", grid_options: { rows: 2 } }, "grid", "height: 100%"],
    ])("leaves its rows alone %s", async (_name, config, layout, style) => {
        const element = await card(config as Partial<AdsbReceiverCardConfig>, layout);
        expect(await filled(element, 200, 300, 440)).toBe(style);
    });

    // Without a pane, the card ends at its last part, as the test boxes have them: the meter at 235, the curve at 203, the
    // figures at 139 and the top at 75, each with 11 px of padding under it and filled up to whole rows.
    it.each([
        ["the meter", {}, ".meter", "min-height: 248px; --spare: 2px"],
        ["the meter, without a curve", { tracked: false }, ".meter", "min-height: 248px; --spare: 2px"],
        [
            "the curve, without a meter, as for a receiver fed over the network",
            { noise: "unknown", signal: "unknown" },
            ".curve",
            "min-height: 248px; --spare: 34px",
        ],
        [
            "the figures, without a meter or a curve",
            { noise: "unknown", signal: "unknown", tracked: false },
            ".figures",
            "min-height: 184px; --spare: 34px",
        ],
        ["the top, for an unavailable receiver", { positions_per_minute: "unavailable" }, ".top", "min-height: 120px; --spare: 34px"],
    ] as Array<[string, Record<string, unknown>, string, string]>)(
        "measures to the end of %s when there is no pane",
        async (_name, values, last, style) => {
            const { tracked, ...readings } = values;
            const state = hass(readings as Record<string, string>);
            state.services = { adsb_live: { get_aircraft_details: {} } };
            if (tracked === false) {
                delete state.entities!["sensor.adsb_aircraft_tracked"];
            }
            const element = document.createElement("adsb-receiver-card");
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER } as AdsbReceiverCardConfig);
            element.layout = "grid";
            element.hass = state;
            document.body.append(element);
            await element.updateComplete;
            const parts = [...one(element, "ha-card").children].map((part) => `.${part.classList[0]}`);
            expect(parts.at(-1)).toBe(last);
            expect(await filled(element, 0)).toBe(style);
        },
    );

    it("never fills the message of a receiver that isn't there", async () => {
        const element = await card({ device: "nothing0001" }, "grid");
        expect(one(element, "ha-card").classList.contains("message")).toBe(true);
        expect(await filled(element, 430)).toBe("");
    });
});

describe("the room a card held to more than it needs leaves", () => {
    // So that the fixed part doesn't move when the other tab, with a shorter pane, is picked.
    it.each([
        ["rows set in the layout tab", { grid_options: { rows: 7 } }, 440, "height: 100%"],
        ["a fixed height", { height: 400 }, 400, "height: 400px"],
    ])("stays at the pane's bottom when held by %s", async (_name, config, height, style) => {
        const element = await card(config, "grid");
        expect(await filled(element, 300, 300, height)).toBe(style);
    });
});

describe("the least height a held card keeps to", () => {
    // The fixed part, the tabs and three steps of the pane, at any width its 9 columns allow, and below 160 px, where the
    // curve's caption wraps, more. Without feeders there are no tabs, and the same rows hold three aircraft.
    it.each([
        ["before it is drawn", undefined, true, "height: 376px", 6],
        ["at a full section's width", 483, true, "height: 376px", 6],
        ["at the narrowest its columns allow", 214, true, "height: 376px", 6],
        ["at 160 px, the last width before the caption wraps", 160, true, "height: 376px", 6],
        ["at 159 px, where the caption wraps", 159, true, "height: 383px", 7],
        ["narrower than its columns allow", 150, true, "height: 383px", 7],
        ["before it is drawn, without feeders", undefined, false, "height: 344px", 6],
        ["at a full section's width, without feeders", 483, false, "height: 344px", 6],
        ["at 160 px, without feeders", 160, false, "height: 344px", 6],
        ["at 159 px, without feeders", 159, false, "height: 351px", 6],
        ["at the narrowest its columns allow, without feeders", 214, false, "height: 344px", 6],
        ["narrower than its columns allow, without feeders", 150, false, "height: 351px", 6],
    ])("is the worst any width from its own up needs, %s", async (_name, width, withFeeders, style, rows) => {
        const element = await card({ height: 100, ...(withFeeders ? { feeders: [{ entity: "binary_sensor.fr24_link" }] } : {}) }, "grid");
        if (width) {
            await filled(element, 120, width, 100);
        }
        expect(one(element, "ha-card").getAttribute("style")).toBe(style);
        expect(element.getGridOptions().min_rows).toBe(rows);
    });

    // From the configuration alone: feeders shown alone, without tabs, still keep the tabs' room, and a card without
    // feeders never has it, whatever the receiver's state or the list action. A receiver that isn't in Home Assistant, or
    // a device without ADS-B Live's sensors, draws its message at the same height.
    const RECEIVERS = {
        available: { device: RECEIVER, values: {}, message: false },
        unavailable: { device: RECEIVER, values: { positions_per_minute: "unavailable" }, message: false },
        "not there": { device: "nothing0001", values: {}, message: true },
        "a device without its sensors": { device: "lamp0001", values: {}, message: true },
    };
    it.each(
        [true, false].flatMap((withFeeders) =>
            Object.keys(RECEIVERS).flatMap((receiver) =>
                [true, false].map((action) => ({ withFeeders, receiver: receiver as keyof typeof RECEIVERS, action })),
            ),
        ),
    )(
        "follows the configuration alone: feeders $withFeeders, a receiver $receiver, the list action $action",
        async ({ withFeeders, receiver, action }) => {
            const { device, values, message } = RECEIVERS[receiver];
            const state = hass(values);
            state.devices!["lamp0001"] = { id: "lamp0001", name: "Lamp" };
            if (!action) {
                state.services = { adsb_live: { get_aircraft_details: {} } };
            }
            const element = document.createElement("adsb-receiver-card");
            element.setConfig({
                type: "custom:adsb-receiver-card",
                device,
                height: 100,
                ...(withFeeders ? { feeders: [{ entity: "binary_sensor.fr24_link" }] } : {}),
            } as AdsbReceiverCardConfig);
            element.layout = "grid";
            element.hass = state;
            document.body.append(element);
            await element.updateComplete;
            const haCard = one(element, "ha-card");
            expect(haCard.classList.contains("message")).toBe(message);
            expect(haCard.getAttribute("style")).toBe(withFeeders ? "height: 376px" : "height: 344px");
            expect(element.getGridOptions().min_rows).toBe(6);
        },
    );

    it.each([
        ["the full layout", {}],
        ["the compact layout", { layout: "compact" as const }],
    ])("is never narrower than 9 columns in %s", async (_name, config) => {
        const element = await card(config, "grid");
        expect(element.getGridOptions()).toMatchObject({ columns: 12, min_columns: 9, rows: "auto" });
    });

    it.each([
        ["is held by rows set in the layout tab", { grid_options: { rows: 2 } }, "grid", "height: 100%", true],
        ["is held by the older layout options' rows", { layout_options: { grid_rows: 2 } }, "grid", "height: 100%", true],
        ["isn't held by a height mode", { height: 300 }, "grid", "", false],
        ["isn't held by rows outside a sections view", { grid_options: { rows: 2 } }, undefined, "", false],
    ])("in the compact layout %s", async (_name, config, layout, style, held) => {
        const element = await card({ layout: "compact", ...config } as Partial<AdsbReceiverCardConfig>, layout);
        const haCard = one(element, "ha-card");
        expect(haCard.getAttribute("style") ?? "").toBe(style);
        expect(haCard.classList.contains("held")).toBe(held);
    });
});

describe("the texts a card may cut short", () => {
    // Spaces as one, no-break ones included, as the markup's own line breaks are in the text.
    const words = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
    const FIXED = [".name", ".version", ".top .line", ".figure .label", ".levels button"];
    type Pane = "aircraft" | "feeders" | "empty" | "failed" | "unavailable";
    const PLANE = { hex: "46a1b2", name: "EXA123", type: "A320", altitude: 3658, speed_kmh: 556, rssi: -8.4, position: true };

    /** A card whose list has one aircraft, or none, and whose feeders' tab is picked when `feeders`. */
    async function withPanes(config: Partial<AdsbReceiverCardConfig>, pane: Pane): Promise<AdsbReceiverCard> {
        const state = hass(pane === "unavailable" ? { positions_per_minute: "unavailable" } : {});
        state.callWS = (async (message: Record<string, unknown>) => {
            if (message.type !== "call_service") {
                return {};
            }
            if (pane === "failed") {
                throw new Error("Action adsb_live.get_receiver_aircraft failed");
            }
            return { response: { aircraft: pane === "empty" ? [] : [{ ...PLANE, heard: new Date().toISOString() }], altitude_unit: "m" } };
        }) as HomeAssistant["callWS"];
        const element = document.createElement("adsb-receiver-card");
        element.setConfig({
            type: "custom:adsb-receiver-card",
            device: RECEIVER,
            // A missing feeder is a problem, which opens the feeders' tab first, so only the feeders' cases have one.
            ...(pane === "feeders" || pane === "unavailable"
                ? { feeders: [{ entity: "binary_sensor.missing", detail: "sensor.missing" }] }
                : {}),
            ...config,
        } as AdsbReceiverCardConfig);
        element.layout = "grid";
        element.hass = state;
        document.body.append(element);
        await element.updateComplete;
        await new Promise((resolve) => setTimeout(resolve, 0));
        await element.updateComplete;
        return element;
    }

    it.each([
        ["the full layout, held", { grid_options: { rows: 6 } }, "aircraft", [...FIXED, ".plane .id", ".plane .sub", ".plane-head span"]],
        ["the full layout, not held", {}, "aircraft", [...FIXED, ".plane .id", ".plane .sub", ".plane-head span"]],
        ["the full layout's feeders", {}, "feeders", [...FIXED, ".tab .label", ".feeder-name", ".feeder-value"]],
        ["the full layout's empty list", {}, "empty", [...FIXED, ".pane .message"]],
        ["the full layout's failed list", {}, "failed", [...FIXED, ".pane .message"]],
        [
            "the full layout of an unavailable receiver",
            {},
            "unavailable",
            [".name", ".version", ".top .line", ".feeder-name", ".feeder-value"],
        ],
        ["the compact layout, held", { layout: "compact" as const, grid_options: { rows: 1 } }, "aircraft", [".name", ".line"]],
        ["the compact layout, not held", { layout: "compact" as const }, "aircraft", [".name", ".line"]],
    ] as Array<[string, Partial<AdsbReceiverCardConfig>, Pane, string[]]>)(
        "carry their whole text as a tooltip in %s",
        async (_name, config, pane, selectors) => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const element = await withPanes(config, pane);
            warn.mockRestore();
            for (const selector of selectors) {
                const texts = [...element.shadowRoot!.querySelectorAll(selector)];
                expect(texts.length, selector).toBeGreaterThan(0);
                for (const text of texts) {
                    // A text with a short form, as the meter's levels and the aircraft's tab, carries its long form.
                    const long = text.classList.contains("short")
                        ? text.parentElement!.querySelector(".long")!
                        : (text.cloneNode(true) as HTMLElement);
                    long.querySelectorAll(".short").forEach((short) => short.remove());
                    expect(words(text.getAttribute("title")), selector).toBe(words(long.textContent));
                }
            }
        },
    );
});

describe("the editor in the compact layout", () => {
    async function editor(config: Partial<AdsbReceiverCardConfig>): Promise<AdsbReceiverCardEditor> {
        const element = document.createElement("adsb-receiver-card-editor");
        element.hass = hass();
        element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...config } as AdsbReceiverCardConfig);
        document.body.append(element);
        await element.updateComplete;
        return element;
    }

    const fields = (element: AdsbReceiverCardEditor) =>
        (element.shadowRoot!.querySelector("ha-form") as unknown as { schema: { name: string }[] }).schema.map((field) => field.name);

    it.each([
        [
            "the full layout offers no height mode, set in YAML only, and the row step unless held to a fixed height",
            { height: 300 },
            [],
            [],
        ],
        ["the full layout offers the row step up to a limit", { max_height: 300 }, [], ["row_step"]],
        [
            "the compact layout offers no height mode, and always its row step",
            { layout: "compact" as const, height: 300 },
            [],
            ["row_step"],
        ],
    ])("%s", async (_name, config, height, step) => {
        const names = fields(await editor(config));
        expect(names.filter((name) => name.startsWith("height"))).toEqual(height);
        expect(names.filter((name) => name === "row_step")).toEqual(step);
    });

    it("keeps a compact card's row step and drops a height left from the full layout, at any edit", async () => {
        const element = await editor({ layout: "compact", height: 300, row_step: "half" });
        const changed = vi.fn();
        element.addEventListener("config-changed", (event) => changed((event as CustomEvent).detail.config));
        const value = {
            type: "custom:adsb-receiver-card",
            device: RECEIVER,
            layout: "compact",
            height: 300,
            row_step: "half",
            name: "Katto",
        };
        element.shadowRoot!.querySelector("ha-form")!.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
        expect(changed).toHaveBeenCalledWith({
            type: "custom:adsb-receiver-card",
            device: RECEIVER,
            layout: "compact",
            row_step: "half",
            name: "Katto",
        });
    });
});

describe("a row step other than full or half", () => {
    it.each([{ row_step: "quarter" }, { row_step: 1 }])("is refused: %o", (extra) => {
        const element = document.createElement("adsb-receiver-card");
        expect(() =>
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...extra } as unknown as AdsbReceiverCardConfig),
        ).toThrow(/^Invalid rounding\./);
    });

    it("takes a step left empty in YAML as whole rows", () => {
        const element = document.createElement("adsb-receiver-card");
        expect(() =>
            element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, row_step: null } as unknown as AdsbReceiverCardConfig),
        ).not.toThrow();
    });
});
