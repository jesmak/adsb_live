/**
 * A dashboard card for the state of an ADS-B receiver from the ADS-B Live integration: whether it hears anything, the
 * aircraft it tracks and their curve over the last day, its range, its signal against the noise, a list of the aircraft
 * it hears, and other feeders' status. The compact layout puts the same on one row, without the list.
 */
import { LitElement, css, html, nothing } from "lit";
import type { CSSResultGroup, PropertyValues, TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";

import { byHeard, fetchReceiverAircraft, hasReceiverAircraft, heardAgo } from "./aircraft";
import type { HeardAircraft, ReceiverAircraft } from "./aircraft";
import { AIRCRAFT_REFRESH_MS, CARD_VERSION, HISTORY_HOURS, HISTORY_REFRESH_MS, RANGE_MINUTES } from "./const";
import type { SensorKey } from "./const";
import "./editor";
import { ScrollFade, fadeStyles } from "./fade";
import type { HomeAssistant } from "./hass";
import { gridMinRows, heightCardSize, heightStyle, validHeight } from "./height";
import { fetchStatistics } from "./history";
import type { StatisticRow } from "./history";
import { browserLanguage, translate } from "./localize/localize";
import {
    curvePoints,
    feederState,
    formatNumber,
    meter,
    meterPlace,
    receiverDevices,
    receiverName,
    receiverSensors,
    receiverStatus,
    linePath,
    peakOf,
    valueOf,
} from "./receiver";
import type { NumberFormat, Point, Status } from "./receiver";
import { drawnScale, fillLimit, filledHeight, filledStyle, spareRoom, validRowStep } from "./rows";
import type { AdsbReceiverCardConfig, FeederConfig } from "./types";

interface CardRegistration {
    type: string;
    name: string;
    description: string;
    documentationURL?: string;
    preview?: boolean;
}

const HOUR = 3_600_000;
/** The curves' boxes in SVG units. The full one stretches to the card's width. */
const CURVE = { width: 360, height: 36 };
const SMALL_CURVE = { width: 90, height: 32 };

/** The tabs' height, which a card with only one pane has no tabs for. */
const TABS_PX = 32;

/**
 * The least a held full card needs on a card this wide or wider: its padding and border, the fixed part (the top, the
 * figures and the curve two half-row steps each, the meter and the tabs one each) and three steps of the pane, the column
 * heads and two aircraft or three feeders, 376 px, six rows of a sections view. A card without feeders has no tabs, and
 * three aircraft in the same six rows. Below 160 the curve's caption wraps, which only a card narrower than its 9
 * columns allow is (in a stack, or by a theme). Measured held from 140 px up both ways.
 */
const LEAST_PX: [number, number][] = [
    [160, 376],
    [0, 383],
];

const px = (value: string) => parseFloat(value) || 0;

type Pane = "aircraft" | "feeders";

export class AdsbReceiverCard extends LitElement {
    @property({ attribute: false }) public hass?: HomeAssistant;
    /** "grid" in a sections view, as Home Assistant sets it. */
    @property({ attribute: false }) public layout?: string;
    @state() private config?: AdsbReceiverCardConfig;
    @state() private history: StatisticRow[] = [];
    /** Whether the recorder has answered for the curve's sensor, so a lone present value means it has no hour yet. */
    @state() private historyLoaded = false;
    private historyOf?: string;
    private timer?: ReturnType<typeof setInterval>;
    /** The pane picked from its tab, until the page is loaded again. Until then the card picks, see `shownPane`. */
    @state() private picked?: Pane;
    /** The receiver's aircraft from the last answer for `aircraftOf`, kept when a later reading fails. */
    @state() private aircraft?: ReceiverAircraft;
    /** Whether reading failed before any answer came. */
    @state() private aircraftFailed = false;
    /** The time the rows' ages count from, moved on every second while the aircraft are shown. */
    @state() private clock = Date.now();
    private aircraftOf?: string;
    private aircraftReadAt = 0;
    private aircraftReading = false;
    private listTimer?: ReturnType<typeof setInterval>;
    /**
     * The point of the curve under the pointer, with its text and where it is drawn, in per cent of the curve's box. It lives
     * only while the pointer is on a curve that is on the page, so it goes on pointerleave, when the curve isn't drawn, and
     * when the card leaves the page, as an element taken off the page gets no pointerleave.
     */
    @state() private hover?: { x: number; y: number; text: string };
    /** The card's width when last measured, 0 before it is drawn. */
    @state() private width = 0;
    /** On automatic rows, the height that ends the card on its rows, and the room that leaves under its content. */
    @state() private filled = 0;
    @state() private spare = 0;
    private frame?: number;
    private readonly resizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => this.measureSoon());

    constructor() {
        super();
        // Fades the pane's edges while the card is held to a height, through the card's own lifecycle.
        new ScrollFade(this, () => (this.heightStyle() ? this.renderRoot.querySelectorAll<HTMLElement>("ha-card > .pane") : []));
    }

    public static getConfigElement(): HTMLElement {
        return document.createElement("adsb-receiver-card-editor");
    }

    /** Offers the first receiver there is when the card is added from the picker. */
    public static getStubConfig(hass?: HomeAssistant): Record<string, unknown> {
        return { device: hass ? (receiverDevices(hass)[0] ?? "") : "" };
    }

    public setConfig(config: AdsbReceiverCardConfig): void {
        if (!config || typeof config.device !== "string" || !config.device) {
            throw new Error(translate(browserLanguage(), "common.invalid_configuration"));
        }
        if (!validHeight(config)) {
            throw new Error(translate(browserLanguage(), "common.invalid_height"));
        }
        if (!validRowStep(config)) {
            throw new Error(translate(browserLanguage(), "common.invalid_row_step"));
        }
        if (this.config && this.config.device !== config.device) {
            // Another receiver's aircraft are none of this one's, even while its own are on the way.
            this.aircraft = undefined;
            this.aircraftFailed = false;
            this.aircraftOf = config.device;
            this.aircraftReadAt = 0;
        }
        this.config = { ...config, feeders: Array.isArray(config.feeders) ? config.feeders.filter((feeder) => !!feeder?.entity) : [] };
    }

    public getCardSize(): number {
        // The fixed part is about six, and the pane a row for each feeder or a few aircraft.
        return this.compact()
            ? 1
            : heightCardSize(this.config ?? {}, 6 + Math.max(4, this.config?.feeders?.length ?? 0), this.minimumHeight());
    }

    /**
     * In a sections view the card takes a whole section by default. Below 9 columns, 214 px on a phone, its texts have too
     * little room. Held, the compact layout is one row at any width.
     */
    public getGridOptions(): Record<string, unknown> {
        return { columns: 12, min_columns: 9, rows: "auto", min_rows: this.compact() ? 1 : gridMinRows(this.minimumHeight()) };
    }

    /** The curve is read when the card comes on the page and every few minutes while it stays there. */
    public connectedCallback(): void {
        super.connectedCallback();
        this.timer = setInterval(() => void this.loadHistory(true), HISTORY_REFRESH_MS);
        void this.loadHistory(true);
        // Back on the page, the aircraft's ages are drawn as they are now, before the first tick.
        if (this.shownPane() === "aircraft") {
            this.clock = Date.now();
        }
        this.followPane();
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        clearInterval(this.timer);
        this.stopList();
        this.resizes?.disconnect();
        cancelAnimationFrame(this.frame ?? 0);
        this.hover = undefined;
    }

    protected shouldUpdate(changed: PropertyValues): boolean {
        const previous = changed.get("hass") as HomeAssistant | undefined;
        if (!this.config || !this.hass || changed.size > 1 || !changed.has("hass") || !previous) {
            return true;
        }
        if (
            previous.entities !== this.hass.entities ||
            previous.devices !== this.hass.devices ||
            previous.locale !== this.hass.locale ||
            previous.language !== this.hass.language ||
            previous.services !== this.hass.services ||
            previous.formatEntityState !== this.hass.formatEntityState
        ) {
            return true;
        }
        // Home Assistant hands the card every state change in the house; only the receiver's sensors and the feeders matter.
        return this.watched().some((id) => previous.states[id] !== this.hass?.states[id]);
    }

    /** A redraw while the aircraft are shown shows their ages as they are now, also the first one after they come back. */
    protected willUpdate(): void {
        if (this.shownPane() === "aircraft") {
            this.clock = Date.now();
        }
        // A curve taken off the card gets no pointerleave, so its tooltip goes with it rather than come back with the curve.
        if (this.hover && !this.curveShown()) {
            this.hover = undefined;
        }
    }

    /** Whether the full layout draws its curve: a receiver that isn't unavailable, with its aircraft tracked sensor. */
    private curveShown(): boolean {
        const hass = this.hass;
        if (!hass || !this.config || this.compact() || !hass.devices?.[this.config.device]) {
            return false;
        }
        const sensors = receiverSensors(hass, this.config.device);
        return !!sensors.aircraft_tracked && receiverStatus(hass, sensors) !== "unavailable";
    }

    protected updated(): void {
        // The first hass, or a receiver picked in the editor, has a curve to read.
        void this.loadHistory(false);
        this.followPane();
        this.placeTopFade();
        if (!this.isConnected) {
            return;
        }
        const card = this.renderRoot.querySelector("ha-card");
        if (card) {
            this.resizes?.observe(card);
        }
        this.measureSoon();
    }

    private measureSoon(): void {
        cancelAnimationFrame(this.frame ?? 0);
        this.frame = requestAnimationFrame(() => this.fillRows());
    }

    /**
     * In a sections view whose rows are left automatic, the card takes the whole rows its content needs, or the half rows
     * with `row_step: half`, so the cards under it stay on the rows, up to the limit of a card that grows up to one. The
     * room left over goes under the top, in the compact
     * layout around its row. Held to a height, the room the pane doesn't need stays at its bottom, so the fixed part
     * doesn't move when the other tab is picked.
     */
    private fillRows(): void {
        const card = this.renderRoot.querySelector<HTMLElement>("ha-card");
        if (!card || !card.clientWidth) {
            return;
        }
        const scale = drawnScale(card);
        // The card's whole width, border included, as the widths the columns give are, unscaled.
        const width = Math.round(card.getBoundingClientRect().width / scale);
        if (width !== this.width) {
            this.width = width;
        }
        const limit = fillLimit(this.sizing(), this.layout, this.minimumHeight());
        if (!limit || card.classList.contains("message")) {
            if (this.filled) this.filled = 0;
            if (this.spare) this.spare = 0;
            return;
        }
        // From the card's top to the end of its own last part, never its own height, which is the min-height set here, and
        // never an element a theme adds to it.
        const parts = card.querySelectorAll<HTMLElement>(
            ":scope > .top, :scope > .figures, :scope > .curve, :scope > .meter, :scope > .tabs, :scope > .pane, :scope > .row",
        );
        const last = parts[parts.length - 1];
        if (!last) {
            return;
        }
        const style = getComputedStyle(card);
        // The drawn distance unscaled, as the margin, padding and border added to it are the layout's.
        let content =
            (last.getBoundingClientRect().bottom - card.getBoundingClientRect().top) / scale +
            px(getComputedStyle(last).marginBottom) +
            px(style.paddingBottom) +
            px(style.borderBottomWidth);
        // The spare room as drawn now.
        const top = card.querySelector<HTMLElement>(":scope > .top");
        content -= top ? px(getComputedStyle(top).paddingBottom) : 0;
        const filled = filledHeight(content, this.sizing(), limit);
        const spare = spareRoom(filled, content);
        if (filled !== this.filled) {
            this.filled = filled;
        }
        if (spare !== this.spare) {
            this.spare = spare;
        }
    }

    /** The card's inline style: the height it is held to, or the rows it fills up to any limit, with their spare room under the top. */
    private cardStyle(): string {
        const style = filledStyle(this.sizing(), this.layout, this.minimumHeight(), this.filled);
        return this.filled ? `${style}; --spare: ${this.spare}px` : style;
    }

    /**
     * Has a held card's top fade start under the list's column heads while they are stuck at the top of the pane, rather
     * than fade them. Stuck, the heads' top is at the pane's, or above it once the list's end pushes them up.
     */
    private placeTopFade = (): void => {
        const pane = this.renderRoot.querySelector<HTMLElement>("ha-card > .pane");
        if (!pane) {
            return;
        }
        const head = pane.closest("ha-card.held") ? pane.querySelector<HTMLElement>(".plane-head")?.getBoundingClientRect() : undefined;
        const top = pane.getBoundingClientRect().top;
        const covered = head && head.top <= top + 0.5 ? Math.max(0, head.bottom - top) : 0;
        if (covered > 0) {
            pane.style.setProperty("--fade-top-offset", `${covered}px`);
        } else {
            pane.style.removeProperty("--fade-top-offset");
        }
    };

    private watched(): string[] {
        if (!this.hass || !this.config) {
            return [];
        }
        const feeders = (this.config.feeders ?? []).flatMap((feeder) => [feeder.entity, feeder.detail ?? ""]);
        return [...Object.values(receiverSensors(this.hass, this.config.device)), ...feeders].filter((id) => !!id);
    }

    /** Reads the curve again when `again`, otherwise only when its sensor has changed since the last read. */
    private async loadHistory(again: boolean): Promise<void> {
        const hass = this.hass;
        const id = hass && this.config ? receiverSensors(hass, this.config.device).aircraft_tracked : undefined;
        if (!hass || !id || (!again && this.historyOf === id)) {
            return;
        }
        if (this.historyOf !== id) {
            // Another receiver's curve is no curve of this one, even while its own is on the way.
            this.history = [];
            this.historyLoaded = false;
            this.historyOf = id;
        }
        const now = Date.now();
        try {
            const rows = await fetchStatistics(hass, id, now - HISTORY_HOURS * HOUR, now);
            if (this.historyOf === id) {
                this.history = rows;
                this.historyLoaded = true;
            }
        } catch (error) {
            // The card still shows the present values; only the curve is left without its past.
            console.warn("adsb-receiver-card: could not read the history of", id, error);
        }
    }

    protected render(): TemplateResult | typeof nothing {
        if (!this.hass || !this.config) {
            return nothing;
        }
        const sensors = receiverSensors(this.hass, this.config.device);
        if (!this.hass.devices?.[this.config.device] || !Object.keys(sensors).length) {
            return html`<ha-card class="message" style=${this.heightStyle()}>${this.text("common.no_receiver")}</ha-card>`;
        }
        const status = receiverStatus(this.hass, sensors);
        return this.compact() ? this.compactCard(sensors, status) : this.fullCard(sensors, status);
    }

    /**
     * The full layout: a fixed part with the receiver, its figures, the curve and the meter, and under it a pane with the
     * aircraft heard or the other feeders, under tabs when it has both (see `shownPane`). Held to a height, only the pane
     * scrolls.
     */
    private fullCard(sensors: Partial<Record<SensorKey, string>>, status: Status): TemplateResult {
        const device = this.hass?.devices?.[this.config?.device ?? ""];
        const version = device?.sw_version ? [device.manufacturer, device.sw_version].filter(Boolean).join(" ") : "";
        const available = status !== "unavailable";
        const name = receiverName(this.hass!, this.config!);
        const statusText = this.text(`status.${status}`);
        const line = available ? [statusText, ...this.rates(sensors)] : [statusText];
        const pane = this.shownPane();
        return html`
            <ha-card class="full ${status} ${this.held() ? "held" : ""} ${this.filled ? "filled" : ""}" style=${this.cardStyle()}>
                <div class="top">
                    ${this.icon()}
                    <div class="who">
                        <div class="first">
                            <span class="name" title=${name}>${name}</span>
                            ${version ? html`<span class="version" title=${version}>${version}</span>` : nothing}
                        </div>
                        <div class="line" title=${line.join(" · ")}>
                            <span class="status">${statusText}</span
                            >${line.slice(1).map((part) => html` · <span class="piece">${part}</span>`)}
                        </div>
                    </div>
                </div>
                ${
                    available
                        ? html`
                              <div class="figures">
                                  ${this.figure(sensors.aircraft_tracked, "figures.tracked")}
                                  ${this.figure(sensors.aircraft_with_position, "figures.with_position")}
                                  ${this.figure(sensors.max_range, "figures.range", true, { minutes: formatNumber(RANGE_MINUTES, this.numberFormat(), 0) })}
                              </div>
                              ${this.curve(sensors)} ${this.meter(sensors)}
                          `
                        : nothing
                }
                ${
                    pane
                        ? html`${this.panes().length > 1 ? this.tabs(sensors) : nothing}
                              <div class="pane ${this.panes().length > 1 ? "" : "alone"}" @scroll=${this.placeTopFade}>
                                  ${pane === "aircraft" ? this.planes() : this.feeders()}
                              </div>`
                        : nothing
                }
            </ha-card>
        `;
    }

    private compactCard(sensors: Partial<Record<SensorKey, string>>, status: Status): TemplateResult {
        const available = status !== "unavailable";
        const line = [
            `${this.number(sensors.aircraft_tracked)} ${this.text("figures.tracked")}`,
            `${this.number(sensors.aircraft_with_position)} ${this.text("figures.with_position")}`,
            this.rates(sensors)[0],
        ];
        const name = receiverName(this.hass!, this.config!);
        const statusText = this.text(`status.${status}`);
        return html`
            <ha-card class="compact ${status} ${this.held() ? "held" : ""}" style=${this.cardStyle()}>
                <button class="row" @click=${() => this.moreInfo(sensors.aircraft_tracked ?? sensors.positions_per_minute)}>
                    ${this.icon()}
                    <div class="who">
                        <div class="name" title="${name} ${statusText}">${name} <span class="status">${statusText}</span></div>
                        ${available ? html`<div class="line" title=${line.join(", ")}>${this.pieces(line)}</div>` : nothing}
                    </div>
                    ${available ? this.smallCurve(sensors) : nothing}
                </button>
            </ha-card>
        `;
    }

    /** The panes the card has: the aircraft with ADS-B Live's action while the receiver is available, the feeders when set. */
    private panes(): Pane[] {
        return [...(this.listShown() ? (["aircraft"] as Pane[]) : []), ...(this.config?.feeders?.length ? (["feeders"] as Pane[]) : [])];
    }

    /**
     * The pane shown: the one picked from its tab, or else the feeders while one of them has a problem, and the aircraft
     * otherwise.
     */
    private shownPane(): Pane | undefined {
        const panes = this.panes();
        if (this.picked && panes.includes(this.picked)) {
            return this.picked;
        }
        return panes.includes("feeders") && this.feederProblem() ? "feeders" : panes[0];
    }

    /** Whether a feeder is down, unavailable or missing. A state that says neither up nor down is no problem. */
    private feederProblem(): boolean {
        return (this.config?.feeders ?? []).some((feeder) => {
            const entity = this.hass?.states[feeder.entity];
            return !entity || entity.state === "unavailable" || feederState(entity) === "error";
        });
    }

    private tabs(sensors: Partial<Record<SensorKey, string>>): TemplateResult {
        const shown = this.shownPane();
        const tab = (pane: Pane, label: TemplateResult, count: string, problem = false) => html`
            <button
                class="tab ${shown === pane ? "on" : ""}"
                role="tab"
                aria-selected=${shown === pane ? "true" : "false"}
                @click=${() => (this.picked = pane)}
            >
                ${label}<span class="count">${count}</span>${
                    problem
                        ? html`<span
                              class="problem"
                              role="img"
                              aria-label=${this.text("feeders.problem")}
                              title=${this.text("feeders.problem")}
                          ></span>`
                        : nothing
                }
            </button>
        `;
        const title = this.text("list.title");
        return html`
            <div class="tabs" role="tablist">
                ${this.panes().map((pane) =>
                    pane === "aircraft"
                        ? tab(
                              pane,
                              html`<span class="label long" title=${title}>${title}</span
                                  ><span class="label short" title=${title}>${this.text("list.title_short")}</span>`,
                              this.aircraftCount(sensors),
                          )
                        : tab(
                              pane,
                              html`<span class="label" title=${this.text("feeders.title")}>${this.text("feeders.title")}</span>`,
                              formatNumber(this.config?.feeders?.length ?? 0, this.numberFormat(), 0),
                              this.feederProblem(),
                          ),
                )}
            </div>
        `;
    }

    /**
     * The aircraft's count: the rows of the list while it is shown and read, so the tab never disagrees with the rows under
     * it, and the aircraft tracked otherwise, as the list isn't read then.
     */
    private aircraftCount(sensors: Partial<Record<SensorKey, string>>): string {
        return this.shownPane() === "aircraft" && this.aircraft
            ? formatNumber(this.aircraft.aircraft.length, this.numberFormat(), 0)
            : this.number(sensors.aircraft_tracked);
    }

    private feeders(): TemplateResult {
        return html`${(this.config?.feeders ?? []).map((feeder) => this.feeder(feeder))}`;
    }

    /** Whether the aircraft can be on the card: the full layout of a receiver that isn't unavailable, with ADS-B Live's action. */
    private listShown(): boolean {
        const hass = this.hass;
        if (!hass || !this.config || this.compact() || !hasReceiverAircraft(hass) || !hass.devices?.[this.config.device]) {
            return false;
        }
        const sensors = receiverSensors(hass, this.config.device);
        return Object.keys(sensors).length > 0 && receiverStatus(hass, sensors) !== "unavailable";
    }

    private planes(): TemplateResult | typeof nothing {
        if (!this.aircraft) {
            return this.aircraftFailed
                ? html`<div class="message" title=${this.text("list.failed")}>${this.text("list.failed")}</div>`
                : nothing;
        }
        if (!this.aircraft.aircraft.length) {
            return html`<div class="message" title=${this.text("list.empty")}>${this.text("list.empty")}</div>`;
        }
        const unit = this.aircraft.altitude_unit;
        return html`
            <div class="planes">
                <div class="plane-head">
                    ${["list.name_type", "list.altitude", "list.signal"].map((key) => html`<span title=${this.text(key)}>${this.text(key)}</span>`)}
                </div>
                ${byHeard(this.aircraft.aircraft).map((plane) => this.plane(plane, unit))}
            </div>
        `;
    }

    private plane(plane: HeardAircraft, unit: string): TemplateResult {
        const format = this.numberFormat();
        const altitude = plane.on_ground
            ? this.text("list.ground")
            : plane.altitude === undefined
              ? "–"
              : `${formatNumber(plane.altitude, format, 0)} ${unit}`;
        const position = this.text(plane.position ? "list.located" : "list.not_located");
        const ago = heardAgo(plane.heard, this.clock);
        const sub = [
            plane.speed_kmh === undefined ? "" : this.text("list.speed", { value: formatNumber(plane.speed_kmh, format, 0) }),
            ago ? this.text(`list.${ago.unit}`, { value: formatNumber(ago.value, format, 0) }) : "",
        ].filter(Boolean);
        return html`
            <div class="plane ${plane.position ? "" : "nopos"}">
                <span class="id"
                    ><span class="ident" title=${[plane.name, plane.type].filter(Boolean).join(" ")}
                        ><span class="callsign">${plane.name}</span
                        >${plane.type ? html` <span class="type">${plane.type}</span>` : nothing}</span
                    ><ha-icon
                        class="position"
                        icon=${plane.position ? "mdi:crosshairs-gps" : "mdi:crosshairs-question"}
                        role="img"
                        aria-label=${position}
                        title=${position}
                    ></ha-icon
                ></span>
                <span class="sub" title=${sub.join(" · ")}
                    >${sub.map((part, index) => html`${index ? " · " : ""}<span class="piece">${part}</span>`)}</span
                >
                <span class="altitude">${altitude}</span>
                <span class="signal"
                    >${plane.rssi === undefined ? nothing : html`<i style="width: ${Number(meterPlace(plane.rssi).toFixed(1))}%"></i>`}</span
                >
            </div>
        `;
    }

    /** Reads the aircraft while they are shown on a card on the page, and stops when they aren't. */
    private followPane(): void {
        if (this.isConnected && this.shownPane() === "aircraft") {
            if (!this.listTimer) {
                this.startList();
            }
        } else {
            this.stopList();
        }
    }

    /** Reads the list now and every AIRCRAFT_REFRESH_MS, and moves its ages on every second. */
    private startList(): void {
        this.stopList();
        void this.loadAircraft();
        this.listTimer = setInterval(() => {
            this.clock = Date.now();
            if (this.clock - this.aircraftReadAt >= AIRCRAFT_REFRESH_MS) {
                void this.loadAircraft();
            }
        }, 1000);
    }

    private stopList(): void {
        clearInterval(this.listTimer);
        this.listTimer = undefined;
    }

    private async loadAircraft(): Promise<void> {
        const hass = this.hass;
        const device = this.config?.device;
        if (!hass || !device || this.aircraftReading || !this.listShown()) {
            return;
        }
        if (this.aircraftOf !== device) {
            // Another receiver's aircraft are none of this one's.
            this.aircraft = undefined;
            this.aircraftFailed = false;
            this.aircraftOf = device;
        }
        this.aircraftReading = true;
        this.aircraftReadAt = Date.now();
        try {
            const answer = await fetchReceiverAircraft(hass, device);
            if (this.aircraftOf === device) {
                this.aircraft = answer;
                this.aircraftFailed = false;
            }
        } catch (error) {
            // A reading that fails after an answer keeps that answer, whose ages go on counting up.
            console.warn("adsb-receiver-card: could not read the aircraft of", device, error);
            if (this.aircraftOf === device && !this.aircraft) {
                this.aircraftFailed = true;
            }
        } finally {
            this.aircraftReading = false;
        }
    }

    /** The compact layout is held only by a sections view's rows, which it fills with its one row at any width. */
    private heightStyle(): string {
        return heightStyle(this.sizing(), this.layout, this.minimumHeight());
    }

    /** The config's sizing, which in the compact layout leaves out the height mode, as only a sections view's rows hold it. */
    private sizing(): Partial<AdsbReceiverCardConfig> {
        const config: Partial<AdsbReceiverCardConfig> = this.config ?? {};
        return this.compact()
            ? { grid_options: config.grid_options, layout_options: config.layout_options, row_step: config.row_step }
            : config;
    }

    private held(): boolean {
        return this.heightStyle() !== "";
    }

    /**
     * The lowest the full layout is held to, in pixels, at any width the card's 9 columns or more allow, or at its measured
     * width if narrower. The texts above the scroller keep to one line then.
     */
    private minimumHeight(): number {
        if (this.compact()) {
            return 0;
        }
        const width = this.width || Infinity;
        // Without feeders the aircraft are the only pane, under no tabs.
        return LEAST_PX.find(([least]) => width >= least)![1] - (this.config?.feeders?.length ? 0 : TABS_PX);
    }

    /** Parts of a sentence, each kept whole, so a number never wraps away from its unit. */
    private pieces(parts: string[]): TemplateResult[] {
        return parts.map((part, index) => html`${index ? ", " : ""}<span class="piece">${part}</span>`);
    }

    private icon(): TemplateResult {
        return html`<div class="icon"><ha-icon icon="mdi:radar"></ha-icon></div>`;
    }

    /** Messages per second and positions per minute, as a sentence's parts. */
    private rates(sensors: Partial<Record<SensorKey, string>>): string[] {
        const positions = valueOf(this.hass!, sensors.positions_per_minute);
        return [
            this.text("rates.messages", { value: this.number(sensors.messages_per_second) }),
            this.text(positions === 1 ? "rates.positions_one" : "rates.positions", { value: this.number(sensors.positions_per_minute) }),
        ];
    }

    private figure(entityId: string | undefined, label: string, withUnit = false, values: Record<string, string> = {}): TemplateResult {
        const unit = withUnit && entityId ? this.hass?.states[entityId]?.attributes.unit_of_measurement : undefined;
        const text = this.text(label, values);
        return html`
            <button class="figure" @click=${() => this.moreInfo(entityId)}>
                <span class="value">${this.number(entityId)}${unit ? html` <span class="unit">${unit}</span>` : nothing}</span>
                <span class="label" title=${text}>${text}</span>
            </button>
        `;
    }

    private curve(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        if (!sensors.aircraft_tracked) {
            return nothing;
        }
        const { path, peak, lone, points, max, start, now } = this.curvePath(sensors.aircraft_tracked, CURVE);
        const hover = this.hover;
        return html`
            <button
                class="curve"
                @click=${() => this.moreInfo(sensors.aircraft_tracked)}
                @pointermove=${(event: PointerEvent) => this.pointAt(event, points, start, now, max)}
                @pointerleave=${() => (this.hover = undefined)}
            >
                <span class="plot">
                    <svg viewBox="0 0 ${CURVE.width} ${CURVE.height}" preserveAspectRatio="none" aria-hidden="true">
                        <line class="base" x1="0" x2=${CURVE.width} y1=${CURVE.height - 1} y2=${CURVE.height - 1}></line>
                        <path class=${lone ? "lone" : ""} d=${path}></path>
                    </svg>
                    ${
                        hover
                            ? html`<span class="dot" style="left: ${hover.x}%; top: ${hover.y}%"></span
                                  ><span class="tip ${hover.x < 25 ? "start" : hover.x > 75 ? "end" : ""}" style="left: ${hover.x}%"
                                      >${hover.text}</span
                                  >`
                            : nothing
                    }
                </span>
                <span class="caption">
                    <span>${this.text("curve.past", { hours: formatNumber(HISTORY_HOURS, this.numberFormat(), 0) })}</span>
                    <span>${peak > 0 ? this.text("curve.peak", { value: formatNumber(peak, this.numberFormat(), 0) }) : ""}</span>
                    <span>${this.text("curve.now")}</span>
                </span>
            </button>
        `;
    }

    /** The curve's point nearest the pointer, as a dot on the line and a tooltip with its hour and value. */
    private pointAt(event: PointerEvent, points: Point[], start: number, now: number, max: number): void {
        const plot = (event.currentTarget as HTMLElement).querySelector(".plot")?.getBoundingClientRect();
        if (!plot || !plot.width || !points.length || now <= start) {
            return;
        }
        const time = start + Math.min(Math.max((event.clientX - plot.left) / plot.width, 0), 1) * (now - start);
        const point = points.reduce((best, one) => (Math.abs(one.time - time) < Math.abs(best.time - time) ? one : best));
        const format = this.numberFormat();
        const value = formatNumber(point.value, format, Number.isInteger(point.value) ? 0 : 1);
        // An hour's point is its mean, drawn at the middle of the hour and named by its start. The last point is the present value.
        const text =
            point.time >= now
                ? this.text("curve.point_now", { value })
                : this.text("curve.point", {
                      time: new Intl.DateTimeFormat(this.language(), { hour: "numeric", minute: "2-digit" }).format(point.time - HOUR / 2),
                      value,
                  });
        const x = Number((((point.time - start) / (now - start)) * 100).toFixed(1));
        const y = Number(((1 - Math.min(Math.max(point.value, 0), max) / max) * 100).toFixed(1));
        if (this.hover?.x !== x || this.hover.text !== text) {
            this.hover = { x, y, text };
        }
    }

    private smallCurve(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        if (!sensors.aircraft_tracked) {
            return nothing;
        }
        const { path, lone } = this.curvePath(sensors.aircraft_tracked, SMALL_CURVE);
        return html`
            <svg class="small-curve" viewBox="0 0 ${SMALL_CURVE.width} ${SMALL_CURVE.height}" aria-hidden="true">
                <path class=${lone ? "lone" : ""} d=${path}></path>
            </svg>
        `;
    }

    private curvePath(
        entityId: string,
        box: { width: number; height: number },
    ): { path: string; peak: number; lone: boolean; points: Point[]; max: number; start: number; now: number } {
        const now = Date.now();
        const start = now - HISTORY_HOURS * HOUR;
        const current = valueOf(this.hass!, entityId);
        // Until the recorder answers, the present value alone would look like a receiver without an hour of statistics.
        if (!this.historyLoaded) {
            return { path: "", peak: 0, lone: false, points: [], max: 4, start, now };
        }
        const points = curvePoints(this.history, start, now, current);
        const peak = peakOf(this.history, start, current);
        // A sky of one aircraft at most shouldn't look as full as a busy one, so the top is never below 4.
        const max = Math.max(peak, 4);
        return { path: linePath(points, start, now, box.width, box.height, max), peak, lone: points.length === 1, points, max, start, now };
    }

    /** Noise and signal on a line, with short names on a narrow card, and the bar between them. */
    private meter(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        const signal = valueOf(this.hass!, sensors.signal);
        const noise = valueOf(this.hass!, sensors.noise);
        const places = meter(signal, noise);
        if (!places) {
            return nothing;
        }
        const gap =
            places.signal === null ? null : { left: Math.min(places.noise, places.signal), width: Math.abs(places.signal - places.noise) };
        const level = (key: string, entityId: string | undefined) =>
            html`<span class="long">${this.text(`meter.${key}`)}</span
                ><span class="short">${this.text(`meter.${key}_short`)}</span> ${this.withUnit(entityId)}`;
        const noiseText = `${this.text("meter.noise")} ${this.withUnit(sensors.noise)}`;
        const signalText =
            signal === null ? this.text("meter.signal_unknown") : `${this.text("meter.signal")} ${this.withUnit(sensors.signal)}`;
        return html`
            <div class="meter">
                <div class="levels">
                    <button title=${noiseText} @click=${() => this.moreInfo(sensors.noise)}>${level("noise", sensors.noise)}</button>
                    <button title=${signalText} @click=${() => this.moreInfo(sensors.signal)}>
                        ${signal === null ? this.text("meter.signal_unknown") : level("signal", sensors.signal)}
                    </button>
                </div>
                <div class="bar">
                    ${gap ? html`<div class="gap" style="left:${gap.left}%;width:${gap.width}%"></div>` : nothing}
                    <div class="mark noise" style="left:${places.noise}%"></div>
                    ${places.signal === null ? nothing : html`<div class="mark signal" style="left:${places.signal}%"></div>`}
                </div>
            </div>
        `;
    }

    private feeder(feeder: FeederConfig): TemplateResult {
        const entity = this.hass?.states[feeder.entity];
        const detail = feeder.detail ? this.hass?.states[feeder.detail] : undefined;
        const name =
            feeder.name ||
            (entity && this.hass?.formatEntityName?.(entity, [{ type: "device" }, { type: "entity" }])) ||
            (entity?.attributes.friendly_name as string | undefined) ||
            feeder.entity;
        const missing = (id: string) => this.text("common.no_entity", { entity: id });
        const parts = [entity ? this.formatState(entity) : missing(feeder.entity)];
        if (feeder.detail) {
            parts.push(detail ? this.formatState(detail) : missing(feeder.detail));
        }
        const value = parts.join(", ");
        return html`
            <button class="feeder" @click=${() => this.moreInfo(feeder.entity)}>
                <span class="dot ${feederState(entity)}"></span>
                <span class="feeder-name" title=${name}>${name}</span>
                <span class="feeder-value" title=${value}>${value}</span>
            </button>
        `;
    }

    private formatState(entity: NonNullable<HomeAssistant["states"][string]>): string {
        return this.hass?.formatEntityState ? this.hass.formatEntityState(entity) : entity.state;
    }

    /** The sensor's number in the viewer's format, or a dash when it has none. */
    private number(entityId: string | undefined): string {
        const value = valueOf(this.hass!, entityId);
        return value === null
            ? "–"
            : formatNumber(value, this.numberFormat(), entityId ? this.hass?.entities?.[entityId]?.display_precision : undefined);
    }

    private withUnit(entityId: string | undefined): string {
        const unit = entityId ? this.hass?.states[entityId]?.attributes.unit_of_measurement : undefined;
        return unit ? `${this.number(entityId)} ${unit}` : this.number(entityId);
    }

    private compact(): boolean {
        return this.config?.layout === "compact";
    }

    private moreInfo(entityId: string | undefined): void {
        if (entityId) {
            this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
        }
    }

    /** A text in the viewer's language, with `{name}` in it replaced, so a translation can put the value where it reads right. */
    private text(key: string, values: Record<string, string> = {}): string {
        return translate(this.language(), key).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
    }

    private numberFormat(): NumberFormat {
        return { language: this.language(), number_format: this.hass?.locale?.number_format };
    }

    private language(): string {
        return this.hass?.locale?.language ?? this.hass?.language ?? browserLanguage();
    }

    static get styles(): CSSResultGroup {
        return [
            css`
                ha-card {
                    /* ha-card's own transition covers every property, so a change in the rows filled would animate. */
                    transition: none;
                    container-type: inline-size;
                    font-variant-numeric: tabular-nums;
                    --receiver-color: var(--secondary-text-color);
                    --receiver-tint: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.06);
                }

                ha-card.receiving {
                    --receiver-color: var(--success-color, #43a047);
                    --receiver-tint: rgba(var(--rgb-success-color, 67, 160, 71), 0.15);
                }

                ha-card.unavailable {
                    --receiver-color: var(--error-color, #db4437);
                    --receiver-tint: rgba(var(--rgb-error-color, 219, 68, 55), 0.15);
                }

                ha-card.message {
                    padding: 16px;
                    color: var(--secondary-text-color);
                }

                button {
                    padding: 0;
                    border: none;
                    background: none;
                    color: inherit;
                    font: inherit;
                    text-align: inherit;
                    cursor: pointer;
                }

                /*
                 * The full layout's parts step in half rows of a sections view, 32 px, so that with its 24 px of padding and
                 * border the card is 32k − 8 px tall and fills whole or half rows exactly: the top, the figures and the curve
                 * two steps each, the meter and the tabs one each, and in the pane each aircraft and each feeder a step, and the
                 * column heads with the room under the last aircraft one more. Held to a height, the texts keep to one line, cut
                 * short with their whole text as a tooltip, so the card's height depends only on its width. Otherwise they wrap:
                 * the pane's message a half row a line, and the other texts at their own line heights, which fillRows still ends
                 * on the rows.
                 */
                .full {
                    display: flex;
                    flex-direction: column;
                    padding: 11px 16px;
                }

                .full > * {
                    flex: none;
                }

                /* The labels keep to one line at any height, as on a narrow card they take short names instead. */
                .version,
                .tab .label,
                .levels button,
                .plane-head span,
                ha-card.held .name,
                ha-card.held .line,
                ha-card.held .figure .label,
                ha-card.held .feeder-name,
                ha-card.held .feeder-value,
                ha-card.held .plane .ident,
                ha-card.held .plane .sub,
                ha-card.held .pane .message {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .name,
                .line,
                .figure .label,
                .feeder-name,
                .feeder-value,
                .plane .ident,
                .plane .sub,
                .pane .message {
                    overflow-wrap: anywhere;
                }

                /* What the rows leave over goes under the top, as padding, which no neighbour's margin can swallow. */
                .top {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    min-height: 64px;
                    padding-bottom: var(--spare, 0px);
                }

                .icon {
                    flex: none;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--receiver-color);
                    background: var(--receiver-tint);
                }

                .who {
                    flex: 1;
                    min-width: 0;
                }

                .first {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                }

                .name {
                    min-width: 0;
                    font-size: 16px;
                    font-weight: var(--ha-font-weight-medium, 500);
                }

                .version {
                    flex: none;
                    max-width: 50%;
                    margin-left: auto;
                    font-size: 12px;
                    color: var(--secondary-text-color);
                }

                .line {
                    font-size: 12px;
                    line-height: 15px;
                    color: var(--secondary-text-color);
                }

                .status {
                    font-size: 13px;
                    color: var(--receiver-color);
                    white-space: nowrap;
                }

                .figures {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    align-items: center;
                    min-height: 64px;
                    text-align: center;
                }

                .figure {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    min-width: 0;
                    padding: 0 4px;
                    text-align: center;
                }

                .figure + .figure {
                    border-left: 1px solid var(--divider-color);
                }

                .value {
                    white-space: nowrap;
                    font-size: 24px;
                    font-weight: var(--ha-font-weight-medium, 500);
                    line-height: 1.2;
                }

                .unit {
                    font-size: 13px;
                    font-weight: var(--ha-font-weight-normal, 400);
                    color: var(--secondary-text-color);
                }

                .figure .label {
                    max-width: 100%;
                    font-size: 12px;
                    line-height: 15px;
                    color: var(--secondary-text-color);
                }

                /* The curve and its caption, with room under the caption before the meter. */
                .curve {
                    display: block;
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 64px;
                    padding-top: 4px;
                }

                .plot {
                    position: relative;
                    display: block;
                    height: 36px;
                }

                /* The present value sits on the right edge, and its dot would be cut in half there. */
                .curve svg,
                .small-curve {
                    overflow: visible;
                }

                .curve svg {
                    display: block;
                    width: 100%;
                    height: 36px;
                }

                svg path {
                    fill: none;
                    stroke: var(--primary-color);
                    stroke-width: 2;
                    stroke-linejoin: round;
                    stroke-linecap: round;
                    vector-effect: non-scaling-stroke;
                }

                /* Only the present value, before the recorder has an hour: a dot that shows. */
                svg path.lone {
                    stroke-width: 6;
                }

                svg .base {
                    stroke: var(--divider-color);
                    stroke-width: 1;
                    vector-effect: non-scaling-stroke;
                }

                /* The point under the pointer, and its hour and value above the line. */
                .plot .dot {
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    margin: -4px 0 0 -4px;
                    border-radius: 50%;
                    background: var(--primary-color);
                    box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color, #fff));
                    pointer-events: none;
                }

                .tip {
                    position: absolute;
                    bottom: calc(100% + 4px);
                    z-index: 2;
                    transform: translateX(-50%);
                    padding: 3px 8px;
                    border-radius: 4px;
                    background: var(--primary-text-color);
                    color: var(--ha-card-background, var(--card-background-color, #fff));
                    font-size: 12px;
                    white-space: nowrap;
                    pointer-events: none;
                }

                .tip.start {
                    transform: none;
                }

                .tip.end {
                    transform: translateX(-100%);
                }

                .caption {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    font-size: 11px;
                    color: var(--secondary-text-color);
                }

                /* A line of levels and the bar, with room under the bar before the tabs. */
                .meter {
                    height: 32px;
                }

                .levels {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    font-size: 12px;
                    line-height: 18px;
                    color: var(--secondary-text-color);
                }

                .levels button {
                    min-width: 0;
                }

                .short {
                    display: none;
                }

                .bar {
                    position: relative;
                    height: 8px;
                    border-radius: 4px;
                    background: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08);
                }

                .gap {
                    position: absolute;
                    top: 0;
                    height: 8px;
                    border-radius: 4px;
                    background: var(--primary-color);
                    opacity: 0.3;
                }

                .mark {
                    position: absolute;
                    top: -3px;
                    width: 3px;
                    height: 14px;
                    margin-left: -1.5px;
                    border-radius: 2px;
                }

                .mark.noise {
                    background: var(--disabled-text-color, #9e9e9e);
                }

                .mark.signal {
                    background: var(--primary-color);
                }

                /* The tabs reach the card's edges, with a line under them that the picked one's underline covers. */
                .tabs {
                    display: flex;
                    height: 32px;
                    margin: 0 -16px;
                    padding: 0 16px;
                    box-shadow: inset 0 -1px var(--divider-color);
                }

                .tab {
                    flex: 1 1 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    min-width: 0;
                    border-bottom: 2px solid transparent;
                    font-size: 13px;
                    color: var(--secondary-text-color);
                }

                .tab.on {
                    border-bottom-color: var(--primary-color);
                    color: var(--primary-text-color);
                }

                .tab .count {
                    flex: none;
                    color: var(--secondary-text-color);
                }

                .tab .problem {
                    flex: none;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--error-color, #db4437);
                }

                /* On a narrow card the version goes, and the meter and the aircraft's tab take their short names. */
                @container (max-width: 299px) {
                    .version,
                    .long {
                        display: none;
                    }

                    .short {
                        display: inline;
                    }

                    .value {
                        font-size: 20px;
                    }

                    .unit {
                        font-size: 12px;
                    }
                }

                /*
                 * Held to a height, by its height mode or a sections view's rows, only the pane scrolls. It reaches out over
                 * the card's padding at the sides and 4 px down, where the focus rings are drawn.
                 */
                ha-card.held {
                    overflow: hidden;
                }

                ha-card.held > .pane {
                    flex: 1 1 auto;
                    min-height: 0;
                    margin: 0 -16px -4px;
                    padding: 0 16px 4px;
                    overflow-y: auto;
                    scrollbar-width: thin;
                }

                /* Filling its rows up to a limit, the pane shrinks but never grows, as the room left over goes under the top
                   and fillRows would otherwise measure it as content, keeping the card from ever shrinking. */
                ha-card.held.filled > .pane {
                    flex-grow: 0;
                }

                .pane .message {
                    font-size: 13px;
                    line-height: 32px;
                    color: var(--secondary-text-color);
                }

                /* The column heads and the room under the last aircraft make one step together. */
                .planes {
                    padding-bottom: 8px;
                }

                .plane-head,
                .plane {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto 56px;
                    align-items: center;
                    gap: 0 8px;
                }

                /* Kept at the top of a held card's pane while the aircraft scroll under it. */
                .plane-head {
                    position: sticky;
                    top: 0;
                    z-index: 1;
                    background: var(--ha-card-background, var(--card-background-color, #fff));
                    padding: 4px 0;
                    font-size: 11px;
                    line-height: 16px;
                    color: var(--secondary-text-color);
                }

                .plane-head span:nth-child(2) {
                    text-align: right;
                }

                /*
                 * Dividers drawn inside the step they top, so they add nothing to its height. A pane without tabs over it
                 * has the tabs' line on its first row, the column heads' kept while the aircraft scroll under them.
                 */
                .plane,
                .feeder + .feeder,
                .pane.alone .plane-head,
                .pane.alone > .message,
                .pane.alone > .feeder:first-child {
                    box-shadow: inset 0 1px var(--divider-color);
                }

                /* Half a row each, so two aircraft fill a row, unless a text wraps. */
                .plane {
                    grid-template-areas: "id altitude signal" "sub altitude signal";
                    padding-top: 2px;
                    font-size: 13px;
                }

                /* The position icon beside the callsign and type rather than after them, so it is never what gets cut. */
                .plane .id {
                    grid-area: id;
                    display: flex;
                    align-items: flex-start;
                    min-width: 0;
                    line-height: 16px;
                }

                .plane .ident {
                    min-width: 0;
                }

                .plane .callsign {
                    font-weight: 500;
                }

                /*
                 * Whether the aircraft's position is known, after its type, centred on the capitals the callsigns and types
                 * are. A flex box of its own, as otherwise it takes the line's height and stretches the row a pixel past the
                 * step.
                 */
                .plane .position {
                    display: flex;
                    flex: none;
                    --mdc-icon-size: 14px;
                    margin: 1px 0 0 4px;
                    color: var(--secondary-text-color);
                }

                .plane .type {
                    margin-left: 2px;
                    color: var(--secondary-text-color);
                }

                .plane .sub {
                    grid-area: sub;
                    font-size: 11px;
                    line-height: 14px;
                    color: var(--secondary-text-color);
                }

                .plane .altitude {
                    grid-area: altitude;
                    text-align: right;
                    white-space: nowrap;
                }

                .plane .signal {
                    grid-area: signal;
                    position: relative;
                    height: 6px;
                    border-radius: 3px;
                    background: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08);
                }

                .plane .signal i {
                    position: absolute;
                    inset: 0 auto 0 0;
                    border-radius: 3px;
                    background: var(--primary-color);
                }

                /* Heard without a position, as the card's figures count it apart. */
                .plane.nopos .callsign {
                    font-weight: 400;
                }

                .plane.nopos .id,
                .plane.nopos .altitude {
                    color: var(--secondary-text-color);
                }

                /* A feeder is a step, which a name or value that wraps leaves at its own line height, as a value 32 px a
                   line reads as two feeders. Held, its name is kept before its value is cut. */
                .feeder {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 32px;
                    padding: 4px 0;
                    font-size: 13px;
                    line-height: 16px;
                }

                .feeder .dot {
                    flex: none;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--disabled-text-color, #9e9e9e);
                }

                .feeder .dot.ok {
                    background: var(--success-color, #43a047);
                }

                .feeder .dot.error {
                    background: var(--error-color, #db4437);
                }

                .feeder-name {
                    flex: 0 0 auto;
                    max-width: 55%;
                }

                .feeder-value {
                    flex: 0 1 auto;
                    min-width: 0;
                    margin-left: auto;
                    text-align: right;
                    color: var(--secondary-text-color);
                }

                /* One row of a sections view at full width, and centred in the rows it fills or is held to. */
                ha-card.compact {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }

                .compact .row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    padding: 9px 14px;
                }

                .compact .icon {
                    width: 36px;
                    height: 36px;
                }

                .compact .name {
                    font-size: 14px;
                }

                .compact .status {
                    font-weight: var(--ha-font-weight-normal, 400);
                }

                .compact .line {
                    line-height: 16px;
                }

                .piece {
                    white-space: nowrap;
                }

                .small-curve {
                    flex: none;
                    width: 90px;
                    height: 32px;
                }

                /* Below this the curve would leave the texts too little room, and they matter more. */
                @container (max-width: 279px) {
                    .small-curve {
                        display: none;
                    }
                }
            `,
            fadeStyles,
        ];
    }
}

// Anyone who installed the card on its own before it came with the integration may still load that copy too, as a
// dashboard resource of its own. Whichever loads first is the card, and the other stays out of the way.
if (!customElements.get("adsb-receiver-card")) {
    console.info(
        `%c  ADSB-RECEIVER-CARD \n%c  ${CARD_VERSION}    `,
        "color: orange; font-weight: bold; background: black",
        "color: white; font-weight: bold; background: dimgray",
    );

    const registry = window as unknown as { customCards?: CardRegistration[] };
    registry.customCards = registry.customCards ?? [];
    registry.customCards.push({
        type: "adsb-receiver-card",
        name: translate(browserLanguage(), "common.name"),
        description: translate(browserLanguage(), "common.description"),
        documentationURL: "https://github.com/jesmak/adsb_live#receiver-card",
        preview: true,
    });
    customElements.define("adsb-receiver-card", AdsbReceiverCard);
}

declare global {
    interface HTMLElementTagNameMap {
        "adsb-receiver-card": AdsbReceiverCard;
    }
}
