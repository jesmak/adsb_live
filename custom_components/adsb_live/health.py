"""The receiver's health from readsb's stats.json.

The values for the last minute are what readsb counted in it; the longest range is
over 15 minutes, as one minute is often too short for a distant aircraft.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .aircraft import number


def _period(stats: Mapping[str, Any], name: str) -> tuple[Mapping[str, Any], float | None]:
    """One of stats.json's periods and its length in seconds."""
    period = stats.get(name)
    if not isinstance(period, Mapping):
        return {}, None
    start, end = number(period.get("start")), number(period.get("end"))
    return period, (end - start if start is not None and end is not None and end > start else None)


def receiver_health(stats: Mapping[str, Any]) -> dict[str, float | None]:
    """The health sensors' values by key, None for what readsb doesn't report.

    readsb reports no signal for a receiver that gets its messages over the network, and none for a minute
    in which it decoded no messages.
    """
    minute, seconds = _period(stats, "last1min")
    quarter, _ = _period(stats, "last15min")
    local = minute.get("local") if isinstance(minute.get("local"), Mapping) else {}

    messages = number(minute.get("messages_valid"))
    if messages is None:
        messages = number(minute.get("messages"))
    positions = number(minute.get("position_count_total"))
    max_distance_m = number(quarter.get("max_distance"))
    with_position = number(stats.get("aircraft_with_pos"))

    return {
        "aircraft_with_position": int(with_position) if with_position is not None else None,
        "messages_per_second": round(messages / seconds, 1) if messages is not None and seconds else None,
        "positions_per_minute": round(positions / seconds * 60) if positions is not None and seconds else None,
        "max_range": round(max_distance_m / 1000, 1) if max_distance_m is not None else None,
        "signal": number(local.get("signal")),
        "noise": number(local.get("noise")),
    }
