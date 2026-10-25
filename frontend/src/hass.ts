/** The little of Home Assistant a card needs, so the unmaintained custom-card-helpers isn't a dependency. */

export interface HassEntity {
    entity_id: string;
    state: string;
    last_changed: string;
    attributes: Record<string, unknown>;
}

/** An entity's registry entry as the frontend has it: enough to find a device's sensors by what they are. */
export interface EntityRegistryEntry {
    entity_id: string;
    device_id?: string | null;
    platform?: string;
    translation_key?: string | null;
    display_precision?: number;
}

export interface DeviceRegistryEntry {
    id: string;
    name?: string | null;
    name_by_user?: string | null;
    manufacturer?: string | null;
    sw_version?: string | null;
}

export interface HomeAssistant {
    states: Record<string, HassEntity | undefined>;
    entities?: Record<string, EntityRegistryEntry | undefined>;
    devices?: Record<string, DeviceRegistryEntry | undefined>;
    language?: string;
    /** `number_format` is "language", "system", "comma_decimal", "decimal_comma", "space_comma", "quote_decimal" or "none". */
    locale?: { language?: string; number_format?: string };
    /** A state in the user's language and number format, with its unit: "Yhdistetty", "5 lentoalusta". */
    formatEntityState?: (entity: HassEntity, state?: string) => string;
    /** The actions Home Assistant has, by domain and name. */
    services?: Record<string, Record<string, unknown> | undefined>;
    /** A websocket command, such as a recorder query or an action with a response. */
    callWS?: <T>(message: Record<string, unknown>) => Promise<T>;
}

export interface LovelaceCardConfig {
    type: string;
    [key: string]: unknown;
}
