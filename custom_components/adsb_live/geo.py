"""The area a feed covers, distances, trail simplification and unit conversions. Coordinates are WGS84 decimal degrees.

GeoJSON positions are [longitude, latitude]; everything else here is latitude first.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

# Mean Earth radius (IUGG).
EARTH_RADIUS_KM = 6371.0088
KM_PER_NM = 1.852
METRES_PER_FOOT = 0.3048
KM_PER_DEGREE_LATITUDE = math.pi * EARTH_RADIUS_KM / 180

# 5 decimals is about 1 m, as the map feed format asks.
COORDINATE_DECIMALS = 5

type Position = Sequence[float]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in kilometres."""
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


@dataclass(frozen=True)
class Area:
    """A circle around a point."""

    latitude: float
    longitude: float
    radius_km: float

    @classmethod
    def from_selector(cls, value: Mapping[str, Any]) -> Area:
        """From a location selector value: latitude, longitude and radius in metres."""
        return cls(float(value["latitude"]), float(value["longitude"]), float(value["radius"]) / 1000)

    def distance_km(self, latitude: float, longitude: float) -> float:
        return haversine_km(self.latitude, self.longitude, latitude, longitude)

    def as_attribute(self) -> dict[str, Any]:
        """The `area` attribute of the Map Feed format (latitude first)."""
        return {
            "center": [round(self.latitude, COORDINATE_DECIMALS), round(self.longitude, COORDINATE_DECIMALS)],
            "radius_km": round(self.radius_km, 3),
        }


def round_position(longitude: float, latitude: float) -> list[float]:
    return [round(longitude, COORDINATE_DECIMALS), round(latitude, COORDINATE_DECIMALS)]


def _offset_km(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    """Distance from a point to a line segment, all in kilometres east and north of the same origin."""
    (px, py), (ax, ay), (bx, by) = point, start, end
    dx, dy = bx - ax, by - ay
    length_squared = dx * dx + dy * dy
    t = 0.0 if length_squared == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_squared))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify_path(path: Sequence[Position], tolerance_km: float) -> list[list[float]]:
    """Douglas–Peucker over [longitude, latitude] positions: leaves out points closer than the tolerance to the line."""
    if len(path) <= 2:
        return [list(position) for position in path]
    origin_lat = float(path[0][1])
    km_per_degree_longitude = KM_PER_DEGREE_LATITUDE * math.cos(math.radians(origin_lat))
    points = [
        ((float(lon) - float(path[0][0])) * km_per_degree_longitude, (float(lat) - origin_lat) * KM_PER_DEGREE_LATITUDE)
        for lon, lat in path
    ]
    keep = [False] * len(path)
    keep[0] = keep[-1] = True
    stack = [(0, len(path) - 1)]
    while stack:
        start, end = stack.pop()
        farthest, distance = -1, tolerance_km
        for index in range(start + 1, end):
            offset = _offset_km(points[index], points[start], points[end])
            if offset > distance:
                farthest, distance = index, offset
        if farthest >= 0:
            keep[farthest] = True
            stack.extend(((start, farthest), (farthest, end)))
    return [list(position) for position, kept in zip(path, keep, strict=True) if kept]
