/** The card's visual editor: the receiver, its name, the layout and other feeders' rows. */
import { LitElement, css, html, nothing } from "lit";
import type { CSSResultGroup, TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";

import { PLATFORM, RECEIVER_MANUFACTURER } from "./const";
import type { HomeAssistant } from "./hass";
import { heightData, heightSchema, tidyHeight } from "./height";
import { browserLanguage, translate } from "./localize/localize";
import type { AdsbReceiverCardConfig, FeederConfig } from "./types";

interface SchemaEntry {
    name: string;
}

function receiverSchema(config: AdsbReceiverCardConfig, text: (key: string) => string) {
    return [
        {
            name: "device",
            required: true,
            selector: { device: { filter: { integration: PLATFORM, manufacturer: RECEIVER_MANUFACTURER } } },
        },
        { name: "name", selector: { text: {} } },
        {
            name: "layout",
            selector: {
                select: {
                    mode: "list",
                    options: [
                        { value: "full", label: text("editor.layout_full") },
                        { value: "compact", label: text("editor.layout_compact") },
                    ],
                },
            },
        },
        { name: "list_open", selector: { boolean: {} } },
        ...heightSchema(config, text),
    ];
}

/** The feeders. A field inside the object selector takes its helper from `description`, as ha-form's computeHelper doesn't reach it. */
function feedersSchema(text: (key: string) => string) {
    return [
        {
            name: "feeders",
            selector: {
                object: {
                    multiple: true,
                    label_field: "entity",
                    fields: {
                        entity: {
                            label: text("editor.feeder_entity"),
                            description: text("editor.feeder_entity_helper"),
                            required: true,
                            selector: { entity: {} },
                        },
                        name: { label: text("editor.feeder_name"), description: text("editor.feeder_name_helper"), selector: { text: {} } },
                        detail: {
                            label: text("editor.feeder_detail"),
                            description: text("editor.feeder_detail_helper"),
                            selector: { entity: {} },
                        },
                    },
                },
            },
        },
    ];
}

/** A feeder keeps only what is filled in, so the configuration stays short. */
export function compactFeeders(feeders: FeederConfig[] | undefined): FeederConfig[] {
    return (feeders ?? [])
        .filter((feeder) => !!feeder?.entity)
        .map((feeder) => {
            const entry: FeederConfig = { entity: feeder.entity };
            if (feeder.name) {
                entry.name = feeder.name;
            }
            if (feeder.detail) {
                entry.detail = feeder.detail;
            }
            return entry;
        });
}

export class AdsbReceiverCardEditor extends LitElement {
    @property({ attribute: false }) public hass?: HomeAssistant;
    @state() private config?: AdsbReceiverCardConfig;

    public setConfig(config: AdsbReceiverCardConfig): void {
        this.config = config;
    }

    protected render(): TemplateResult | typeof nothing {
        if (!this.hass || !this.config) {
            return nothing;
        }
        const data = { layout: "full", ...heightData(this.config) };
        // Two forms, so that the feeders' helper, which Home Assistant's list of objects doesn't show, sits above the list.
        return html`
            <ha-form
                .hass=${this.hass}
                .data=${data}
                .schema=${receiverSchema(this.config, (key) => this.text(key))}
                .computeLabel=${(entry: SchemaEntry) => this.text(`editor.${entry.name}`)}
                .computeHelper=${(entry: SchemaEntry) => this.helper(entry.name)}
                @value-changed=${this.valueChanged}
            ></ha-form>
            <p class="helper">${this.text("editor.feeders_helper")}</p>
            <ha-form
                .hass=${this.hass}
                .data=${data}
                .schema=${feedersSchema((key) => this.text(key))}
                .computeLabel=${(entry: SchemaEntry) => this.text(`editor.${entry.name}`)}
                @value-changed=${this.valueChanged}
            ></ha-form>
        `;
    }

    static get styles(): CSSResultGroup {
        return css`
            .helper {
                margin: 16px 0 8px;
                padding: 0 16px;
                font-size: 12px;
                line-height: 1.4;
                color: var(--secondary-text-color);
            }
        `;
    }

    private valueChanged(event: CustomEvent<{ value: AdsbReceiverCardConfig }>): void {
        const config: AdsbReceiverCardConfig = tidyHeight(event.detail.value);
        const feeders = compactFeeders(config.feeders);
        if (feeders.length) {
            config.feeders = feeders;
        } else {
            delete config.feeders;
        }
        if (!config.name) {
            delete config.name;
        }
        // The default is shown in the form but left out of the configuration.
        if (!config.layout || config.layout === "full") {
            delete config.layout;
        }
        if (!config.list_open) {
            delete config.list_open;
        }
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    }

    private text(key: string): string {
        return translate(this.language(), key);
    }

    private helper(name: string): string | undefined {
        const key = `editor.${name}_helper`;
        const helper = translate(this.language(), key);
        return helper === key ? undefined : helper;
    }

    private language(): string {
        return this.hass?.locale?.language ?? this.hass?.language ?? browserLanguage();
    }
}

if (!customElements.get("adsb-receiver-card-editor")) {
    customElements.define("adsb-receiver-card-editor", AdsbReceiverCardEditor);
}

declare global {
    interface HTMLElementTagNameMap {
        "adsb-receiver-card-editor": AdsbReceiverCardEditor;
    }
}
