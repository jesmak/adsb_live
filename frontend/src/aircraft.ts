/**
 * The aircraft the receiver itself hears, from ADS-B Live's action get_receiver_aircraft, which reads readsb when asked.
 * The card asks only while its list is open, so nothing is read, and nothing written to the recorder, when nobody looks.
 */

import { PLATFORM } from "./const";
import type { HomeAssistant } from "./hass";

export const RECEIVER_AIRCRAFT_SERVICE = "get_receiver_aircraft";

/** An aircraft as the action gives it. Fields readsb doesn't know are left out. */
export interface HeardAircraft {
    hex: string;
    /** Its callsign, or its registration or address, as ADS-B Live's feeds name it. */
    name: string;
    registration?: string;
    /** Its ICAO type designator, such as A320. */
    type?: string;
    /** In the answer's `altitude_unit`. */
    altitude?: number;
    on_ground?: boolean;
    /** Its ground speed. */
    speed_kmh?: number;
    /** Its signal in dBFS. */
    rssi?: number;
    /** When it was last heard, as an ISO time. */
    heard: string;
    /** Whether it has a position from the last minute. */
    position: boolean;
}

export interface ReceiverAircraft {
    aircraft: HeardAircraft[];
    /** "m" or "ft", the receiver's altitude unit in ADS-B Live. */
    altitude_unit: string;
}

/** Whether ADS-B Live has the action. A version from before it has no list to give. */
export function hasReceiverAircraft(hass: HomeAssistant): boolean {
    return !!hass.services?.[PLATFORM]?.[RECEIVER_AIRCRAFT_SERVICE];
}

export async function fetchReceiverAircraft(hass: HomeAssistant, device: string): Promise<ReceiverAircraft> {
    if (!hass.callWS) {
        throw new Error("Home Assistant has no websocket to ask with");
    }
    const result = await hass.callWS<{ response?: ReceiverAircraft }>({
        type: "call_service",
        domain: PLATFORM,
        service: RECEIVER_AIRCRAFT_SERVICE,
        service_data: { device },
        return_response: true,
    });
    const answer = result?.response;
    if (!answer || !Array.isArray(answer.aircraft)) {
        throw new Error("ADS-B Live answered without a list of aircraft");
    }
    return answer;
}

/** The aircraft heard last first, and those heard at the same moment by name. */
export function byHeard(aircraft: HeardAircraft[]): HeardAircraft[] {
    return [...aircraft].sort((one, other) => Date.parse(other.heard) - Date.parse(one.heard) || one.name.localeCompare(other.name));
}

/** How long ago it was heard: now under 2 seconds, then in seconds, then in whole minutes. Null for a time that isn't one. */
export function heardAgo(heard: string, now: number): { unit: "now" | "seconds" | "minutes"; value: number } | null {
    const seconds = Math.floor((now - Date.parse(heard)) / 1000);
    if (!Number.isFinite(seconds)) {
        return null;
    }
    if (seconds < 2) {
        return { unit: "now", value: 0 };
    }
    return seconds < 60 ? { unit: "seconds", value: seconds } : { unit: "minutes", value: Math.floor(seconds / 60) };
}
