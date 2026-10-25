/**
 * The aircraft tracked over the last hours, from the recorder's long-term statistics: an hourly mean and maximum, so a
 * day is 24 rows rather than a reading a minute, and the statistics outlast the state history.
 */
import type { HomeAssistant } from "./hass";

/** One row of `recorder/statistics_during_period`. Times are milliseconds. */
export interface StatisticRow {
    start: number;
    mean?: number | null;
    max?: number | null;
}

export async function fetchStatistics(hass: HomeAssistant, id: string, start: number, now: number): Promise<StatisticRow[]> {
    if (!hass.callWS) {
        return [];
    }
    const answer = await hass.callWS<Record<string, StatisticRow[]>>({
        type: "recorder/statistics_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(now).toISOString(),
        statistic_ids: [id],
        period: "hour",
        types: ["mean", "max"],
    });
    return answer?.[id] ?? [];
}
