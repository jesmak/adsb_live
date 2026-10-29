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
import type { NumberFormat, Status } from "./receiver";
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
const CURVE = { width: 360, height: 44 };
const SMALL_CURVE = { width: 90, height: 32 };

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
    @state() private listOpen = false;
    /** The receiver's aircraft from the last answer for `aircraftOf`, kept when a later reading fails. */
    @state() private aircraft?: ReceiverAircraft;
    /** Whether reading failed before any answer came. */
    @state() private aircraftFailed = false;
    /** The time the rows' ages count from, moved on every second while the list is open on the card. */
    @state() private clock = Date.now();
    private aircraftOf?: string;
    private aircraftReadAt = 0;
    private aircraftReading = false;
    private listTimer?: ReturnType<typeof setInterval>;

    constructor() {
        super();
        // Fades the scroller's edges while the card is held to a height, through the card's own lifecycle.
        new ScrollFade(this, () => (this.heightStyle() ? this.renderRoot.querySelectorAll<HTMLElement>("ha-card > .scroll") : []));
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
        const previous = this.config;
        // A list opened or shut by hand stays so, unless the configuration's own list_open changed. Only true opens it, so
        // list_open: false is the same as none.
        if (!previous || (previous.list_open === true) !== (config.list_open === true)) {
            this.listOpen = config.list_open === true;
        }
        if (previous && previous.device !== config.device) {
            // Another receiver's aircraft are none of this one's, even while its own are on the way.
            this.aircraft = undefined;
            this.aircraftFailed = false;
            this.aircraftOf = config.device;
            this.aircraftReadAt = 0;
        }
        this.config = { ...config, feeders: Array.isArray(config.feeders) ? config.feeders.filter((feeder) => !!feeder?.entity) : [] };
        if (this.isConnected) {
            if (this.listOpen) {
                this.startList();
            } else {
                this.stopList();
            }
        }
    }

    public getCardSize(): number {
        // One for the list's heading.
        return this.compact() ? 1 : heightCardSize(this.config ?? {}, 6 + (this.config?.feeders?.length ?? 0), this.minimumHeight());
    }

    /**
     * In a sections view the card takes a whole section by default and is never narrower than half of one. The full
     * layout is never lower than its minimum height, while the compact one is a row whose height its content sets.
     */
    public getGridOptions(): Record<string, unknown> {
        return { columns: 12, min_columns: 6, rows: "auto", ...(this.compact() ? {} : { min_rows: gridMinRows(this.minimumHeight()) }) };
    }

    /** The curve is read when the card comes on the page and every few minutes while it stays there. */
    public connectedCallback(): void {
        super.connectedCallback();
        this.timer = setInterval(() => void this.loadHistory(true), HISTORY_REFRESH_MS);
        void this.loadHistory(true);
        if (this.listOpen) {
            this.startList();
        }
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        clearInterval(this.timer);
        this.stopList();
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

    /** A redraw while the list is on the card shows its ages as they are now, also the first one after it comes back. */
    protected willUpdate(): void {
        if (this.listOpen && this.listShown()) {
            this.clock = Date.now();
        }
    }

    protected updated(): void {
        // The first hass, or a receiver picked in the editor, has a curve to read.
        void this.loadHistory(false);
        this.placeTopFade();
    }

    /**
     * Has a held card's top fade start under the list's column heads while they are stuck at the top of the scroller,
     * rather than fade them. Stuck, the heads' top is at the scroller's, or above it once the list's end pushes them up.
     * They cover only as far as the fold shows them: nothing while it is shut, and less as it slides shut, as the heads
     * stay in it then. It runs again when the fold's slide ends, as a fold shut from the editor redraws while still open.
     */
    private placeTopFade = (): void => {
        const scroll = this.renderRoot.querySelector<HTMLElement>("ha-card > .scroll");
        if (!scroll) {
            return;
        }
        const held = scroll.closest("ha-card.held");
        const head = held ? scroll.querySelector<HTMLElement>(".plane-head")?.getBoundingClientRect() : undefined;
        const fold = head ? scroll.querySelector<HTMLElement>(".fold-in")?.getBoundingClientRect() : undefined;
        const top = scroll.getBoundingClientRect().top;
        const covered =
            head && fold && fold.bottom > fold.top && head.top <= top + 0.5 ? Math.max(0, Math.min(head.bottom, fold.bottom) - top) : 0;
        if (covered > 0) {
            scroll.style.setProperty("--fade-top-offset", `${covered}px`);
        } else {
            scroll.style.removeProperty("--fade-top-offset");
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

    private fullCard(sensors: Partial<Record<SensorKey, string>>, status: Status): TemplateResult {
        const device = this.hass?.devices?.[this.config?.device ?? ""];
        const version = device?.sw_version ? [device.manufacturer, device.sw_version].filter(Boolean).join(" ") : "";
        const available = status !== "unavailable";
        const height = this.heightStyle();
        return html`
            <ha-card class="full ${status} ${height ? "held" : ""}" style=${height}>
                <div class="top">
                    ${this.icon()}
                    <div class="who">
                        <div class="name">${receiverName(this.hass!, this.config!)}</div>
                        <div class="status">${this.text(`status.${status}`)}</div>
                        ${available ? html`<div class="rates">${this.pieces(this.rates(sensors))}</div>` : nothing}
                    </div>
                    ${version ? html`<div class="version">${version}</div>` : nothing}
                </div>
                ${
                    available
                        ? html`
                              <div class="figures">
                                  ${this.figure(sensors.aircraft_tracked, "figures.tracked")}
                                  ${this.figure(sensors.aircraft_with_position, "figures.with_position")}
                                  ${this.figure(sensors.max_range, "figures.range", true, { minutes: formatNumber(RANGE_MINUTES, this.numberFormat(), 0) })}
                              </div>
                          `
                        : nothing
                }
                <div class="scroll" @scroll=${this.placeTopFade}>
                    ${available ? html`${this.curve(sensors)} ${this.meter(sensors)} ${this.aircraftList()}` : nothing}
                    ${
                        this.config?.feeders?.length
                            ? html`<div class="feeders">${this.config.feeders.map((feeder) => this.feeder(feeder))}</div>`
                            : nothing
                    }
                </div>
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
        return html`
            <ha-card class="compact ${status}">
                <button class="row" @click=${() => this.moreInfo(sensors.aircraft_tracked ?? sensors.positions_per_minute)}>
                    ${this.icon()}
                    <div class="who">
                        <div class="name">
                            ${receiverName(this.hass!, this.config!)} <span class="status">${this.text(`status.${status}`)}</span>
                        </div>
                        ${available ? html`<div class="line">${this.pieces(line)}</div>` : nothing}
                    </div>
                    ${available ? this.smallCurve(sensors) : nothing}
                </button>
            </ha-card>
        `;
    }

    /** The aircraft the receiver hears, folded under its heading. It is read only while it is open. */
    private aircraftList(): TemplateResult | typeof nothing {
        if (!this.listShown()) {
            return nothing;
        }
        const count = this.listOpen && this.aircraft ? this.aircraft.aircraft.length : undefined;
        return html`
            <div class="aircraft">
                <button
                    class="list-heading ${this.listOpen ? "open" : ""}"
                    aria-expanded=${this.listOpen ? "true" : "false"}
                    @click=${this.toggleList}
                >
                    <span class="list-title">${this.text("list.title")}</span>
                    ${count === undefined ? nothing : html`<span class="count">${formatNumber(count, this.numberFormat(), 0)}</span>`}
                    <ha-icon icon="mdi:chevron-down"></ha-icon>
                </button>
                <div
                    class="fold ${this.listOpen ? "open" : ""}"
                    ?inert=${!this.listOpen}
                    @transitionend=${this.placeTopFade}
                    @transitioncancel=${this.placeTopFade}
                >
                    <div class="fold-in">${this.planes()}</div>
                </div>
            </div>
        `;
    }

    /** Whether the list is on the card: the full layout of a receiver that isn't unavailable, with ADS-B Live's action. */
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
            return this.aircraftFailed ? html`<div class="message">${this.text("list.failed")}</div>` : nothing;
        }
        if (!this.aircraft.aircraft.length) {
            return html`<div class="message">${this.text("list.empty")}</div>`;
        }
        const unit = this.aircraft.altitude_unit;
        return html`
            <div class="planes">
                <div class="plane-head">
                    <span>${this.text("list.name_type")}</span>
                    <span>${this.text("list.altitude")}</span>
                    <span>${this.text("list.signal")}</span>
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
                    ><span class="callsign">${plane.name}</span
                    >${plane.type ? html` <span class="type">${plane.type}</span>` : nothing}<ha-icon
                        class="position"
                        icon=${plane.position ? "mdi:crosshairs-gps" : "mdi:crosshairs-question"}
                        role="img"
                        aria-label=${position}
                        title=${position}
                    ></ha-icon
                ></span>
                <span class="sub">${sub.join(" · ")}</span>
                <span class="altitude">${altitude}</span>
                <span class="signal"
                    >${plane.rssi === undefined ? nothing : html`<i style="width: ${Number(meterPlace(plane.rssi).toFixed(1))}%"></i>`}</span
                >
            </div>
        `;
    }

    private toggleList(): void {
        this.listOpen = !this.listOpen;
        if (this.listOpen && this.isConnected) {
            this.startList();
        } else {
            this.stopList();
        }
    }

    /** Reads the list now and every AIRCRAFT_REFRESH_MS, and moves its ages on every second. */
    private startList(): void {
        this.stopList();
        this.clock = Date.now();
        void this.loadAircraft();
        this.listTimer = setInterval(() => {
            // Open but not on the card, as for an unavailable receiver, nothing is read or drawn until it comes back.
            if (!this.listShown()) {
                return;
            }
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

    /** The compact layout is a row whose height its content sets, so only the full one is held to a height. */
    private heightStyle(): string {
        return this.compact() ? "" : heightStyle(this.config ?? {}, this.layout, this.minimumHeight());
    }

    /**
     * The lowest the full layout is held to, in pixels: its padding, the top with the name, status and rates, the
     * figures and the curve with its caption, each with the space above it, as measured on a full section's width.
     */
    private minimumHeight(): number {
        if (this.compact()) {
            return 0;
        }
        const padding = 30;
        const top = 57;
        const figures = 14 + 46;
        const curve = 14 + 59;
        return padding + top + figures + curve;
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
        return html`
            <button class="figure" @click=${() => this.moreInfo(entityId)}>
                <span class="value">${this.number(entityId)}${unit ? html` <span class="unit">${unit}</span>` : nothing}</span>
                <span class="label">${this.text(label, values)}</span>
            </button>
        `;
    }

    private curve(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        if (!sensors.aircraft_tracked) {
            return nothing;
        }
        const { path, peak, lone } = this.curvePath(sensors.aircraft_tracked, CURVE);
        return html`
            <button class="curve" @click=${() => this.moreInfo(sensors.aircraft_tracked)}>
                <svg viewBox="0 0 ${CURVE.width} ${CURVE.height}" preserveAspectRatio="none" aria-hidden="true">
                    <line class="base" x1="0" x2=${CURVE.width} y1=${CURVE.height - 1} y2=${CURVE.height - 1}></line>
                    <path class=${lone ? "lone" : ""} d=${path}></path>
                </svg>
                <span class="caption">
                    <span>${this.text("curve.past", { hours: formatNumber(HISTORY_HOURS, this.numberFormat(), 0) })}</span>
                    <span>${peak > 0 ? this.text("curve.peak", { value: formatNumber(peak, this.numberFormat(), 0) }) : ""}</span>
                    <span>${this.text("curve.now")}</span>
                </span>
            </button>
        `;
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

    private curvePath(entityId: string, box: { width: number; height: number }): { path: string; peak: number; lone: boolean } {
        const now = Date.now();
        const start = now - HISTORY_HOURS * HOUR;
        const current = valueOf(this.hass!, entityId);
        // Until the recorder answers, the present value alone would look like a receiver without an hour of statistics.
        if (!this.historyLoaded) {
            return { path: "", peak: 0, lone: false };
        }
        const points = curvePoints(this.history, start, now, current);
        const peak = peakOf(this.history, start, current);
        // A sky of one aircraft at most shouldn't look as full as a busy one, so the top is never below 4.
        return { path: linePath(points, start, now, box.width, box.height, Math.max(peak, 4)), peak, lone: points.length === 1 };
    }

    private meter(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        const signal = valueOf(this.hass!, sensors.signal);
        const noise = valueOf(this.hass!, sensors.noise);
        const places = meter(signal, noise);
        if (!places) {
            return nothing;
        }
        const gap =
            places.signal === null ? null : { left: Math.min(places.noise, places.signal), width: Math.abs(places.signal - places.noise) };
        return html`
            <div class="meter">
                <div class="levels">
                    <button @click=${() => this.moreInfo(sensors.noise)}>
                        ${this.text("meter.noise")} ${this.withUnit(sensors.noise)}
                    </button>
                    <button @click=${() => this.moreInfo(sensors.signal)}>
                        ${signal === null ? this.text("meter.signal_unknown") : `${this.text("meter.signal")} ${this.withUnit(sensors.signal)}`}
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
        const name = feeder.name || (entity?.attributes.friendly_name as string | undefined) || feeder.entity;
        const missing = (id: string) => this.text("common.no_entity", { entity: id });
        const parts = [entity ? this.formatState(entity) : missing(feeder.entity)];
        if (feeder.detail) {
            parts.push(detail ? this.formatState(detail) : missing(feeder.detail));
        }
        const value = parts.join(", ");
        return html`
            <button class="feeder" @click=${() => this.moreInfo(feeder.entity)}>
                <span class="dot ${feederState(entity)}"></span>
                <span class="feeder-name">${name}</span>
                <span class="feeder-value">${value}</span>
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

                .full {
                    padding: 14px 16px 12px;
                }

                .top {
                    display: flex;
                    align-items: center;
                    gap: 12px;
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

                .name {
                    font-size: 16px;
                    font-weight: var(--ha-font-weight-medium, 500);
                    overflow-wrap: anywhere;
                }

                .status {
                    font-size: 13px;
                    color: var(--receiver-color);
                }

                .rates,
                .version,
                .label,
                .caption,
                .levels,
                .feeder-value,
                .line,
                .unit {
                    color: var(--secondary-text-color);
                }

                .rates {
                    font-size: 12px;
                }

                .version {
                    align-self: flex-start;
                    font-size: 12px;
                    white-space: nowrap;
                }

                .piece,
                .levels button {
                    white-space: nowrap;
                }

                /* On a narrow card the version goes under the rates, leaving the name and rates the width, and the figures shrink so a number keeps its unit. */
                @container (max-width: 299px) {
                    .top {
                        flex-wrap: wrap;
                        row-gap: 2px;
                    }

                    .version {
                        order: 3;
                        flex-basis: 100%;
                        padding-left: 52px;
                    }

                    .value {
                        font-size: 20px;
                    }

                    .unit {
                        font-size: 12px;
                    }
                }

                .figures {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    margin: 14px 0 4px;
                    text-align: center;
                }

                .figure {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
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
                }

                .label {
                    font-size: 12px;
                }

                .curve {
                    display: block;
                    width: 100%;
                    margin-top: 10px;
                }

                /* The present value sits on the right edge, and its dot would be cut in half there. */
                .curve svg,
                .small-curve {
                    overflow: visible;
                }

                .curve svg {
                    display: block;
                    width: 100%;
                    height: 44px;
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

                .caption {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    font-size: 11px;
                }

                .meter {
                    margin-top: 12px;
                }

                .levels {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: space-between;
                    gap: 0 12px;
                    margin-bottom: 4px;
                    font-size: 12px;
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

                /*
                 * Held to a height, by its height mode or a sections view's rows, the card is a column in which the top and
                 * the figures stay and the rest scrolls together, the list of aircraft with it rather than on its own.
                 */
                ha-card.held {
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                ha-card.held > * {
                    flex: none;
                }

                /*
                 * The scroller clips at its padding box, so it reaches out over the card's padding at the sides and 4 px up and
                 * down, where the curve's present dot, the meter's marks at its ends and the focus rings are drawn.
                 */
                ha-card.held > .scroll {
                    margin: -4px -16px;
                    padding: 4px 16px;
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    scrollbar-width: thin;
                }

                /* Clipped, not hidden, which would make the fold the scroller the list's column heads stick to. */
                ha-card.held .fold-in {
                    overflow: clip;
                }

                .aircraft {
                    margin-top: 12px;
                    border-top: 1px solid var(--divider-color);
                }

                .list-heading {
                    display: flex;
                    flex: none;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 10px 0 8px;
                    font-size: 14px;
                }

                .list-heading .count {
                    color: var(--secondary-text-color);
                }

                .list-heading ha-icon {
                    --mdc-icon-size: 20px;
                    margin-left: auto;
                    color: var(--secondary-text-color);
                    transition: transform var(--ha-animation-duration-fast, 150ms);
                }

                .list-heading.open ha-icon {
                    transform: rotate(180deg);
                }

                /* The list slides open and shut, on Home Assistant's timing, which is near none under the system's reduced motion. */
                .fold {
                    display: grid;
                    grid-template-rows: 0fr;
                    min-height: 0;
                    transition: grid-template-rows var(--ha-animation-duration-normal, 250ms) ease;
                }

                .fold.open {
                    grid-template-rows: 1fr;
                }

                .fold-in {
                    min-height: 0;
                    overflow: hidden;
                }

                @media (prefers-reduced-motion: reduce) {
                    .fold,
                    .list-heading ha-icon {
                        transition: none;
                    }
                }

                /* The list's last row has its own line under it, the feeders'. */
                .aircraft + .feeders {
                    margin-top: 0;
                }

                .aircraft .message {
                    padding: 4px 0 8px;
                    font-size: 13px;
                    color: var(--secondary-text-color);
                }

                .plane-head,
                .plane {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto 56px;
                    align-items: center;
                    gap: 0 8px;
                }

                /*
                 * Kept at the top of a held card's scroller, over the scroller's 4 px of top padding, with as much more padding
                 * of its own, drawn above where it sits. Elsewhere the fold, which hides its overflow, holds it in place.
                 */
                .plane-head {
                    position: sticky;
                    top: -4px;
                    z-index: 1;
                    background: var(--ha-card-background, var(--card-background-color, #fff));
                    margin-top: -4px;
                    padding: 6px 0 4px;
                    font-size: 11px;
                    color: var(--secondary-text-color);
                }

                .plane-head span:nth-child(2) {
                    text-align: right;
                }

                .plane {
                    grid-template-areas: "id altitude signal" "sub altitude signal";
                    padding: 5px 0;
                    border-top: 1px solid var(--divider-color);
                    font-size: 13px;
                }

                .plane .id {
                    grid-area: id;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .plane .callsign {
                    font-weight: 500;
                }

                /* Whether the aircraft's position is known, after its type, centred on the capitals the callsigns and types are. */
                .plane .position {
                    --mdc-icon-size: 14px;
                    margin-left: 4px;
                    color: var(--secondary-text-color);
                    vertical-align: 1px;
                }

                .plane .type {
                    margin-left: 2px;
                    color: var(--secondary-text-color);
                }

                .plane .sub {
                    grid-area: sub;
                    font-size: 11px;
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

                .feeders {
                    margin-top: 12px;
                    padding-top: 6px;
                    border-top: 1px solid var(--divider-color);
                }

                .feeder {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 2px 10px;
                    width: 100%;
                    padding: 7px 0;
                    font-size: 13px;
                }

                .dot {
                    flex: none;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--disabled-text-color, #9e9e9e);
                }

                .dot.ok {
                    background: var(--success-color, #43a047);
                }

                .dot.error {
                    background: var(--error-color, #db4437);
                }

                .feeder-name {
                    flex: 1 1 auto;
                    min-width: 0;
                    overflow-wrap: anywhere;
                }

                .feeder-value {
                    margin-left: auto;
                    text-align: right;
                    overflow-wrap: anywhere;
                }

                .compact .row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    padding: 12px 14px;
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

                .line {
                    font-size: 12px;
                    overflow-wrap: anywhere;
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
