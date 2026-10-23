"""Aircraft: readsb's JSON, from the local receiver or adsb.fi, as map feed features.

Field meanings follow readsb's README-json.md. Altitudes are in feet, rates in
feet per minute and speeds in knots, as ADS-B sends them.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from homeassistant.util import dt as dt_util

from .colors import altitude_color
from .const import (
    CONF_ADSB_FI,
    CONF_AREA,
    CONF_COLOR_BY_ALTITUDE,
    CONF_OVERHEAD_ALTITUDE,
    CONF_OVERHEAD_ALTITUDE_UNIT,
    CONF_OVERHEAD_RADIUS,
    CONF_TRAIL_MINUTES,
    DEFAULT_COLOR_BY_ALTITUDE,
    DEFAULT_OVERHEAD_ALTITUDE,
    DEFAULT_OVERHEAD_RADIUS_KM,
    DOMAIN,
    SERVICE_GET_AIRCRAFT_DETAILS,
)
from .geo import KM_PER_NM, METRES_PER_FOOT, Area, haversine_km, round_position, simplify_path
from .texts import Texts

# readsb keeps an aircraft for a while after its last position; older positions aren't live.
MAX_POSITION_AGE_SECONDS = 60
# The receiver's own list holds the aircraft heard in the last minute, with a position or without.
HEARD_SECONDS = 60

# readsb's vertical rates come in steps of 64 ft/min, so anything smaller is level flight.
LEVEL_RATE_FT_MIN = 100

# Trails are simplified to what a map shows, as the map feed format suggests.
TRAIL_TOLERANCE_KM = 0.02

# ADS-B emitter categories (DO-260B) as feed kinds. Category set C isn't aircraft and is left out: surface
# vehicles and obstacles, fixed or tethered such as a balloon, and C0 without a subcategory.
KINDS = {
    "A1": "air.light",
    "A2": "air.small",
    "A3": "air.large",
    # High vortex large, such as a Boeing 757.
    "A4": "air.large",
    "A5": "air.heavy",
    "A6": "air.high_performance",
    "A7": "air.rotorcraft",
    "B1": "air.glider",
    "B2": "air.balloon",
    "B4": "air.light",
    "B6": "air.drone",
}
OTHER_KIND = "air.other"
# Categories that name a kind of aircraft, not a weight band. They win over the type, as tar1090's table makes a Hawk or a
# Hornet a medium jet and a motorglider a light piston. B4, an ultralight, is left to the type, which makes one light too.
EXACT_CATEGORIES = ("A6", "A7", "B1", "B2", "B6")
# Types tar1090's table tells only by their designator, with no description its code places: the glider, and the
# ultralight and paraglider, light as the category B4 makes them.
DESIGNATOR_KINDS = {"GLID": "air.glider", "ULAC": "air.light", "PARA": "air.light"}


def aircraft_kind(plane: Aircraft, types: Mapping[str, str]) -> str:
    """The kind a category of a kind of aircraft gives (EXACT_CATEGORIES), otherwise the kind its type has in `types` (see
    type_kinds), and the kind its category gives when the table doesn't know the type.

    The weight bands of A1 to A5 say nothing of the engines, as an ATR transmits A2 like a regional jet.
    """
    category = str(plane.data.get("category") or "")
    if category not in EXACT_CATEGORIES and (kind := types.get(str(plane.data.get("t") or "").upper())):
        return kind
    return KINDS.get(category, OTHER_KIND)


def type_kind(code: str, wake: str) -> str | None:
    """A type's kind from the description code (L2J: a landplane with two jets) and wake category in tar1090's table.

    The table marks a helicopter H, a gyrocopter G, a tiltrotor R, a balloon or airship B and a drone D. The wake
    categories match the emitter categories' weights: light under 7 t (A1), heavy over 136 t (A5). Medium covers both
    small and large (A2 and A3), told apart by the engines, as the table gives no weights: jets are large, turboprops
    turboprop, and pistons small. None for a description the code can't place, such as a tower's (T0-).
    """
    if code[:1] in ("H", "G", "R"):
        return "air.rotorcraft"
    if code[:1] == "B":
        return "air.balloon"
    if code[:1] == "D":
        return "air.drone"
    if not code:
        return None
    if wake in ("H", "J"):
        return "air.heavy"
    if wake == "M":
        return {"J": "air.large", "T": "air.turboprop"}.get(code[-1:], "air.small")
    if wake == "L":
        return "air.light"
    return None


def type_kinds(table: Mapping[str, Any]) -> dict[str, str]:
    """Each type's kind from tar1090's icao_aircraft_types2.js, {"A320": ["AIRBUS A-320", "L2J", "M"], ...}.

    Types that get no kind, by their designator (see DESIGNATOR_KINDS) or their class, and entries not of that shape,
    are left out.
    """
    kinds: dict[str, str] = {}
    for designator, entry in table.items():
        if not isinstance(entry, list) or len(entry) < 3 or not isinstance(entry[1], str) or not isinstance(entry[2], str):
            continue
        code = str(designator).upper()
        if kind := DESIGNATOR_KINDS.get(code) or type_kind(entry[1], entry[2]):
            kinds[code] = kind
    return kinds


EMERGENCY_SQUAWKS = ("7500", "7600", "7700")
# dbFlags bit for a military aircraft in the aircraft database.
DB_FLAG_MILITARY = 1


@dataclass(frozen=True)
class FeedConfig:
    area: Area
    adsb_fi: bool
    trail_minutes: int
    color_by_altitude: bool
    overhead_radius_km: float
    overhead_altitude: float
    # "m" or "ft", the unit the altitude was entered in.
    overhead_altitude_unit: str

    @classmethod
    def from_data(cls, data: Mapping[str, Any]) -> FeedConfig:
        """From config subentry data."""
        return cls(
            area=Area.from_selector(data[CONF_AREA]),
            adsb_fi=data[CONF_ADSB_FI],
            trail_minutes=data[CONF_TRAIL_MINUTES],
            # A feed saved before a setting existed in the integration uses its default.
            color_by_altitude=data.get(CONF_COLOR_BY_ALTITUDE, DEFAULT_COLOR_BY_ALTITUDE),
            overhead_radius_km=data.get(CONF_OVERHEAD_RADIUS, DEFAULT_OVERHEAD_RADIUS_KM),
            overhead_altitude=data.get(CONF_OVERHEAD_ALTITUDE, DEFAULT_OVERHEAD_ALTITUDE["m"]),
            overhead_altitude_unit=data.get(CONF_OVERHEAD_ALTITUDE_UNIT, "m"),
        )


@dataclass(frozen=True)
class Aircraft:
    hex: str
    latitude: float
    longitude: float
    # When the position was received, in seconds since the epoch.
    position_time: float
    # adsb, mlat, tisb, other or adsb_fi
    source: str
    data: Mapping[str, Any]

    @property
    def feature_id(self) -> str:
        return f"aircraft:{self.hex}"

    @property
    def callsign(self) -> str:
        return str(self.data.get("flight") or "").strip()

    @property
    def on_ground(self) -> bool:
        return self.data.get("alt_baro") == "ground"

    @property
    def altitude_ft(self) -> int | None:
        """Barometric altitude, or the geometric one when there is none; 0 on the ground."""
        if self.on_ground:
            return 0
        for key in ("alt_baro", "alt_geom"):
            if (value := number(self.data.get(key))) is not None:
                return round(value)
        return None


def number(value: Any) -> float | None:
    """A finite number, or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def local_source(message_type: Any) -> str:
    """Where readsb got a position from, by its `type`."""
    text = str(message_type or "")
    if text.startswith(("adsb", "adsr")):
        return "adsb"
    if text == "mlat":
        return "mlat"
    if text.startswith("tisb"):
        return "tisb"
    return "other"


def parse_aircraft(data: Mapping[str, Any], remote: bool = False) -> list[Aircraft]:
    """Aircraft with a live position from readsb's aircraft.json, or from adsb.fi when `remote`.

    aircraft.json gives `now` in seconds and its list as `aircraft`; adsb.fi gives
    `now` in milliseconds and its list as `ac`.
    """
    now = number(data.get("now"))
    if now is None:
        raise ValueError("No time in the aircraft list")
    if remote:
        now /= 1000
    result: list[Aircraft] = []
    items = data.get("ac" if remote else "aircraft") or []
    if not isinstance(items, list):
        raise ValueError("The aircraft list isn't a list")
    for item in items:
        if not isinstance(item, Mapping):
            continue
        hex_code = str(item.get("hex") or "").lower()
        latitude, longitude, age = number(item.get("lat")), number(item.get("lon")), number(item.get("seen_pos"))
        if not hex_code or latitude is None or longitude is None or age is None or age > MAX_POSITION_AGE_SECONDS:
            continue
        if str(item.get("category") or "").startswith("C"):
            continue
        source = "adsb_fi" if remote else local_source(item.get("type"))
        result.append(Aircraft(hex_code, latitude, longitude, now - age, source, item))
    return result


def heard_aircraft(data: Mapping[str, Any], unit: str) -> list[dict[str, Any]]:
    """Every aircraft in readsb's aircraft.json heard in the last minute, with a position or without, for the receiver's list.

    The altitude is in `unit`, "m" or "ft", and the speed is the ground speed in km/h, as on the map. Fields readsb doesn't
    give are left out.
    """
    now = number(data.get("now"))
    if now is None:
        raise ValueError("No time in the aircraft list")
    items = data.get("aircraft") or []
    if not isinstance(items, list):
        raise ValueError("The aircraft list isn't a list")
    result: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, Mapping):
            continue
        hex_code = str(item.get("hex") or "").lower()
        seen = number(item.get("seen"))
        if not hex_code or seen is None or seen > HEARD_SECONDS or str(item.get("category") or "").startswith("C"):
            continue
        on_ground = item.get("alt_baro") == "ground"
        altitudes = () if on_ground else (number(item.get("alt_baro")), number(item.get("alt_geom")))
        altitude_ft = next((value for value in altitudes if value is not None), None)
        speed = number(item.get("gs"))
        rssi = number(item.get("rssi"))
        position_age = number(item.get("seen_pos"))
        position = (
            number(item.get("lat")) is not None
            and number(item.get("lon")) is not None
            and position_age is not None
            and position_age <= MAX_POSITION_AGE_SECONDS
        )
        plane: dict[str, Any] = {
            "hex": hex_code,
            "name": display_name(hex_code, item),
            "registration": str(item.get("r") or "") or None,
            "type": str(item.get("t") or "") or None,
            "altitude": None if altitude_ft is None else round(altitude_ft if unit == "ft" else altitude_ft * METRES_PER_FOOT),
            "on_ground": True if on_ground else None,
            "speed_kmh": None if speed is None else round(speed * KM_PER_NM),
            "rssi": None if rssi is None else round(rssi, 1),
            "heard": dt_util.utc_from_timestamp(now - seen).isoformat(timespec="seconds"),
            "position": position,
        }
        result.append({key: value for key, value in plane.items() if value is not None})
    return result


def merge(local: Iterable[Aircraft], remote: Iterable[Aircraft]) -> list[Aircraft]:
    """The local receiver's aircraft, then those only adsb.fi has."""
    result = list(local)
    seen = {aircraft.hex for aircraft in result}
    result.extend(aircraft for aircraft in remote if aircraft.hex not in seen)
    return result


def in_area(aircraft: Iterable[Aircraft], area: Area) -> list[Aircraft]:
    return [plane for plane in aircraft if area.distance_km(plane.latitude, plane.longitude) <= area.radius_km]


@dataclass
class Trails:
    """Where each aircraft has been in the last minutes, kept in memory between updates."""

    points: dict[str, list[tuple[float, float, float]]] = field(default_factory=dict)

    def update(self, aircraft: Iterable[Aircraft], now: float, minutes: int) -> None:
        for plane in aircraft:
            trail = self.points.setdefault(plane.hex, [])
            if not trail or plane.position_time > trail[-1][0]:
                trail.append((plane.position_time, plane.longitude, plane.latitude))
        cutoff = now - minutes * 60
        for hex_code in list(self.points):
            kept = [point for point in self.points[hex_code] if point[0] >= cutoff]
            if kept:
                self.points[hex_code] = kept
            else:
                del self.points[hex_code]

    def line(self, hex_code: str) -> list[list[float]] | None:
        """The trail as rounded [longitude, latitude] positions, or None when it has fewer than two."""
        path = [round_position(lon, lat) for _, lon, lat in self.points.get(hex_code, [])]
        path = [position for index, position in enumerate(path) if index == 0 or position != path[index - 1]]
        return simplify_path(path, TRAIL_TOLERANCE_KM) if len(path) >= 2 else None


# ---------------- feed features ----------------


def altitude_text(plane: Aircraft, texts: Texts, unit: str) -> str | None:
    """ "10 060 m" or "33 000 ft", or "on the ground"."""
    if plane.on_ground:
        return texts("on_ground")
    feet = plane.altitude_ft
    if feet is None:
        return None
    if unit == "ft":
        return f"{texts.number(feet)} ft"
    return f"{texts.number(feet * METRES_PER_FOOT, -1)} m"


def vertical_rate_text(plane: Aircraft, texts: Texts, unit: str) -> str | None:
    if plane.on_ground:
        return None
    rate = number(plane.data.get("baro_rate"))
    if rate is None:
        rate = number(plane.data.get("geom_rate"))
    if rate is None:
        return None
    if abs(rate) < LEVEL_RATE_FT_MIN:
        return texts("level")
    if unit == "ft":
        text = f"{texts.number(abs(rate))} ft/min"
    else:
        text = f"{texts.number(abs(rate) * METRES_PER_FOOT / 60, 1)} m/s"
    return texts("climbing" if rate > 0 else "descending", rate=text)


def detail_rows(plane: Aircraft, distance_km: float, texts: Texts, unit: str) -> list[dict[str, Any]]:
    data = plane.data
    candidates = [
        ("altitude", altitude_text(plane, texts, unit)),
        ("vertical_rate", vertical_rate_text(plane, texts, unit)),
        ("squawk", data.get("squawk")),
        ("registration", data.get("r")),
        ("type", data.get("t")),
        ("distance", f"{texts.number(distance_km, 1)} km"),
        ("source", texts(f"source_{plane.source}")),
    ]
    return [{"label": texts(label), "value": str(value)} for label, value in candidates if value not in (None, "")]


def emergency_squawk(plane: Aircraft) -> str | None:
    squawk = str(plane.data.get("squawk") or "")
    return squawk if squawk in EMERGENCY_SQUAWKS else None


def is_military(plane: Aircraft) -> bool:
    flags = plane.data.get("dbFlags")
    return isinstance(flags, int) and not isinstance(flags, bool) and bool(flags & DB_FLAG_MILITARY)


def notices(plane: Aircraft, texts: Texts) -> list[str]:
    result = []
    if squawk := emergency_squawk(plane):
        result.append(texts(f"squawk_{squawk}"))
    if is_military(plane):
        result.append(texts("military"))
    return result


def is_overhead(plane: Aircraft, config: FeedConfig) -> bool:
    """In the air within the feed's overhead radius of its area's centre, and below its overhead altitude."""
    if config.overhead_radius_km <= 0 or plane.on_ground or plane.altitude_ft is None:
        return False
    within = config.area.distance_km(plane.latitude, plane.longitude) <= config.overhead_radius_km
    # In the unit the limit was entered in, so an aircraft at exactly the limit as entered is never below it.
    altitude = plane.altitude_ft if config.overhead_altitude_unit == "ft" else plane.altitude_ft * METRES_PER_FOOT
    return within and altitude < config.overhead_altitude


def measure(aircraft: Iterable[Aircraft], distance_from: tuple[float, float]) -> list[tuple[float, Aircraft]]:
    """Each aircraft with its distance in km from `distance_from` (latitude, longitude), nearest first."""
    return sorted(
        ((haversine_km(distance_from[0], distance_from[1], plane.latitude, plane.longitude), plane) for plane in aircraft),
        key=lambda pair: pair[0],
    )


def heading(plane: Aircraft) -> int | None:
    """Its track over the ground, or where its nose points when it sends no track, in whole degrees."""
    value = number(plane.data.get("track"))
    if value is None:
        value = number(plane.data.get("true_heading"))
    return round(value) % 360 if value is not None else None


def aircraft_name(plane: Aircraft) -> str:
    """Its callsign, or its registration or address when it sends no callsign."""
    return display_name(plane.hex, plane.data)


def display_name(hex_code: str, data: Mapping[str, Any]) -> str:
    """An aircraft's callsign, or its registration or address when it sends no callsign, the same on the map and in the list."""
    return str(data.get("flight") or "").strip() or str(data.get("r") or "") or hex_code.upper()


def build_features(
    measured: Iterable[tuple[float, Aircraft]],
    trails: Trails | None,
    texts: Texts,
    unit: str,
    color_by_altitude: bool,
    feed_id: str,
    types: Mapping[str, str],
) -> list[dict[str, Any]]:
    """Point features for the measured aircraft (see measure), in their order, each followed by its trail when it has one.

    Altitudes and vertical rates are written in `unit`, "m" or "ft". With `color_by_altitude`, each point has its
    altitude's colour, which its trail takes too. Each point's details on tap name the feed by `feed_id`. An aircraft's
    kind comes from its category or its type in `types` (see aircraft_kind).
    """
    features: list[dict[str, Any]] = []
    for distance_km, plane in measured:
        kind = aircraft_kind(plane, types)
        features.append(point_feature(plane, distance_km, texts, unit, color_by_altitude, feed_id, kind))
        if trails is not None and (line := trails.line(plane.hex)):
            features.append(
                {
                    "type": "Feature",
                    "id": f"{plane.feature_id}/trail",
                    "geometry": {"type": "LineString", "coordinates": line},
                    "properties": {"kind": kind, "point": plane.feature_id},
                }
            )
    return features


def point_feature(
    plane: Aircraft, distance_km: float, texts: Texts, unit: str, color_by_altitude: bool, feed_id: str, kind: str
) -> dict[str, Any]:
    data = plane.data
    name = aircraft_name(plane)
    speed = number(data.get("gs"))
    altitude = altitude_text(plane, texts, unit)
    category = str(data.get("category") or "")
    # Addresses starting with ~ aren't ICAO addresses, such as a TIS-B track's or an anonymous one.
    address = plane.hex.upper() if plane.hex.startswith("~") else f"ICAO {plane.hex.upper()}"
    properties: dict[str, Any] = {
        "name": name,
        "kind": kind,
        "updated": dt_util.utc_from_timestamp(plane.position_time).isoformat(timespec="seconds"),
        "heading": heading(plane),
        "stationary": True if plane.on_ground else None,
        "speed_kmh": round(speed * KM_PER_NM) if speed is not None else None,
        "subtitle": " · ".join(str(part) for part in (data.get("desc"), data.get("ownOp")) if part),
        "details": detail_rows(plane, distance_km, texts, unit),
        "notices": notices(plane, texts),
        "color": altitude_color(plane.altitude_ft, plane.on_ground) if color_by_altitude else None,
        "footer": " · ".join(part for part in (address, category) if part),
        "list": {"value": altitude} if altitude else None,
        # The route and photo, fetched only for an aircraft someone opens.
        "detail_action": {"action": f"{DOMAIN}.{SERVICE_GET_AIRCRAFT_DETAILS}", "data": {"feed": feed_id, "hex": plane.hex}},
        # The feed's own properties, for the list's sort orders.
        "distance_km": round(distance_km, 1),
        "altitude_ft": plane.altitude_ft,
    }
    return {
        "type": "Feature",
        "id": plane.feature_id,
        "geometry": {"type": "Point", "coordinates": round_position(plane.longitude, plane.latitude)},
        "properties": {key: value for key, value in properties.items() if value not in (None, "", [])},
    }
