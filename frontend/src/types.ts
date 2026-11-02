import type { LovelaceCardConfig } from "./hass";
import type { RowStepConfig } from "./rows";

/** Another feeder's status as a row under the receiver, such as Flightradar24's fr24feed. */
export interface FeederConfig {
    /** Whether the feeder is up: its dot is green when it is on or connected, red when it is off or disconnected, the other way round for a problem sensor. */
    entity: string;
    /** Replaces the entity's own name. */
    name?: string;
    /** A second entity whose state is shown after the first, such as the aircraft the feeder reports. */
    detail?: string;
}

export interface AdsbReceiverCardConfig extends LovelaceCardConfig, RowStepConfig {
    /** The receiver's device, from the ADS-B Live integration. */
    device: string;
    /** Replaces the device's name. */
    name?: string;
    /** `full` shows everything, `compact` one row with a small curve. */
    layout?: "full" | "compact";
    feeders?: FeederConfig[];
}
