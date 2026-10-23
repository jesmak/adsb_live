"""Reading readsb's JSON, merging the sources, trails, colours and the feed's features."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from custom_components.adsb_live.aircraft import (
    Aircraft,
    Trails,
    build_features,
    in_area,
    measure,
    merge,
    notices,
    parse_aircraft,
    type_kind,
    type_kinds,
)
from custom_components.adsb_live.api import normalize_url, without_login
from custom_components.adsb_live.colors import GROUND_COLOR, UNKNOWN_COLOR, altitude_color, legend
from custom_components.adsb_live.const import LANGUAGES
from custom_components.adsb_live.geo import Area, distance_to_leg_km, haversine_km
from custom_components.adsb_live.health import receiver_health
from custom_components.adsb_live.texts import PLACEHOLDER, Texts, load_texts

from .conftest import AREA, RECEIVER_POSITION, adsb_fi_aircraft, local_aircraft, stats

ENGLISH = load_texts("en")
FINNISH = load_texts("fi")
COMPONENT_DIR = Path(__file__).parent.parent / "custom_components" / "adsb_live"
FEED_ID = "feed-1"


def plane(hex_code: str, position_time: float, longitude: float, latitude: float = 61.5, **data: object) -> Aircraft:
    return Aircraft(hex_code, latitude, longitude, position_time, "adsb", data)


def features_of(
    aircraft: list[Aircraft], texts: Any = ENGLISH, unit: str = "m", colors: bool = False, types: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    return build_features(measure(aircraft, RECEIVER_POSITION), None, texts, unit, colors, FEED_ID, types or {})


def test_only_live_positions_of_aircraft_are_read() -> None:
    aircraft = parse_aircraft(local_aircraft())
    assert [(plane.hex, plane.source) for plane in aircraft] == [
        ("46a1b2", "adsb"),
        ("461f00", "mlat"),
        ("462000", "adsb"),
        ("466000", "adsb"),
    ], "a stale position, no position and a ground vehicle are left out"


# What transmits a category of set C is no aircraft for the feeds, on the ground or in the air, nor is C0 without a subcategory.
@pytest.mark.parametrize("category", ["C0", "C1", "C3"])
def test_set_c_is_left_out_of_the_feeds(category: str) -> None:
    base = {"hex": "467000", "type": "adsb_icao", "alt_baro": 400, "lat": 61.5, "lon": 23.8, "seen_pos": 1}
    data = {"now": 1792566385.0, "aircraft": [{**base, "category": category}, {**base, "hex": "468000", "category": "A1"}]}
    assert [plane.hex for plane in parse_aircraft(data)] == ["468000"]


def test_adsb_fi_gives_its_time_in_milliseconds() -> None:
    data = adsb_fi_aircraft()
    aircraft = parse_aircraft(data, remote=True)
    assert [plane.source for plane in aircraft] == ["adsb_fi", "adsb_fi"]
    assert abs(aircraft[1].position_time - (data["now"] / 1000 - 0.5)) < 0.001


def test_the_receiver_wins_over_adsb_fi() -> None:
    local = parse_aircraft(local_aircraft())
    merged = merge(local, parse_aircraft(adsb_fi_aircraft(), remote=True))
    assert [plane.hex for plane in merged] == ["46a1b2", "461f00", "462000", "466000", "4ca123"]
    assert merged[0].source == "adsb"


def test_features_are_nearest_first_with_their_details() -> None:
    features = features_of(in_area(parse_aircraft(local_aircraft()), Area.from_selector(AREA)))
    assert [feature["id"] for feature in features] == ["aircraft:461f00", "aircraft:46a1b2", "aircraft:462000"]

    airliner = features[1]
    assert airliner["geometry"] == {"type": "Point", "coordinates": [23.9, 61.55]}
    properties = airliner["properties"]
    assert properties["name"] == "EXA123"
    assert properties["kind"] == "air.large"
    assert properties["heading"] == 90
    assert properties["speed_kmh"] == 556
    assert "stationary" not in properties
    assert "color" not in properties, "colours only when the feed asks for them"
    assert properties["subtitle"] == "AIRBUS A-320 · Example Air"
    assert properties["footer"] == "ICAO 46A1B2 · A3"
    assert properties["list"] == {"value": "3,660 m"}
    assert properties["altitude_ft"] == 12000
    assert properties["details"] == [
        {"label": "Altitude", "value": "3,660 m"},
        {"label": "Vertical rate", "value": "descending 5.2 m/s"},
        {"label": "Squawk", "value": "4521"},
        {"label": "Registration", "value": "OH-ZZA"},
        {"label": "Type", "value": "A320"},
        {"label": "Distance", "value": f"{properties['distance_km']} km"},
        {"label": "Source", "value": "ADS-B"},
    ], "the operator is in the subtitle, not again as a row"
    assert "notices" not in properties

    light = features[0]["properties"]
    assert light["name"] == "OH-ZZB", "without a callsign, the registration"
    assert light["kind"] == "air.light"
    assert {"label": "Vertical rate", "value": "level"} in light["details"]
    assert {"label": "Source", "value": "MLAT"} in light["details"]

    on_ground = features[2]["properties"]
    assert on_ground["stationary"] is True
    assert on_ground["altitude_ft"] == 0
    assert on_ground["list"] == {"value": "on the ground"}
    assert [row["label"] for row in on_ground["details"]][:2] == ["Altitude", "Distance"], "no vertical rate on the ground"


def test_finnish_numbers_have_a_decimal_comma_and_spaces_between_thousands() -> None:
    assert FINNISH.number(36000) == "36\u00a0000"
    assert FINNISH.number(9.44, 1) == "9,4"
    assert ENGLISH.number(36000) == "36,000"
    assert ENGLISH.number(3657.6, -1) == "3,660"
    features = features_of(parse_aircraft(local_aircraft())[:1], FINNISH)
    assert features[0]["properties"]["details"][:2] == [
        {"label": "Korkeus", "value": "3\u00a0660 m"},
        {"label": "Pystynopeus", "value": "laskee 5,2 m/s"},
    ]


def test_an_altitude_just_below_sea_level_is_never_minus_zero() -> None:
    for feet in (-1, -11, -16):
        properties = features_of([plane("a", 0, 24.0, alt_baro=feet, baro_rate=-30)])[0]["properties"]
        assert properties["details"][0] == {"label": "Altitude", "value": "0 m"}, feet
        assert properties["list"] == {"value": "0 m"}
    assert ENGLISH.number(-0.04, 1) == "0.0"
    # Below the 10 m step, it shows.
    properties = features_of([plane("a", 0, 24.0, alt_baro=-50)])[0]["properties"]
    assert properties["details"][0] == {"label": "Altitude", "value": "-20 m"}


def test_altitudes_can_be_in_feet() -> None:
    properties = features_of(parse_aircraft(local_aircraft())[:1], unit="ft")[0]["properties"]
    assert properties["details"][:2] == [
        {"label": "Altitude", "value": "12,000 ft"},
        {"label": "Vertical rate", "value": "descending 1,024 ft/min"},
    ]
    assert properties["list"] == {"value": "12,000 ft"}
    assert properties["altitude_ft"] == 12000, "the sort order doesn't depend on the unit"


def test_an_aircraft_without_callsign_or_registration_is_named_by_its_address() -> None:
    properties = features_of([plane("4ca123", 0, 24.0, category="B6")])[0]["properties"]
    assert properties["name"] == "4CA123"
    assert properties["kind"] == "air.drone"
    assert properties["footer"] == "ICAO 4CA123 · B6"
    assert features_of([plane("4ca124", 0, 24.0)])[0]["properties"]["kind"] == "air.other"


# A category that names a kind of aircraft (fast and agile, rotorcraft, glider, balloon, drone) gives the kind, as
# tar1090's table makes a Hawk a medium jet and a motorglider a light piston. Otherwise the type's class in the table
# decides when the table knows the type, as the weight bands of A1 to A5 say nothing of the engines: an ATR transmits A2
# like a regional jet. Without the type in the table it is the category, and without both it is other.
TYPES = {"A320": "air.large", "AT76": "air.turboprop", "HAWK": "air.large", "SF25": "air.light"}


@pytest.mark.parametrize(
    ("category", "type_code", "expected"),
    [
        ("A6", "HAWK", "air.high_performance"),
        ("A7", "A320", "air.rotorcraft"),
        ("B1", "SF25", "air.glider"),
        ("B2", "A320", "air.balloon"),
        ("B6", "A320", "air.drone"),
        ("A2", "AT76", "air.turboprop"),
        ("A3", "AT76", "air.turboprop"),
        ("A2", "A320", "air.large"),
        ("A5", "A320", "air.large"),
        ("A1", "SF25", "air.light"),
        ("A3", "A320", "air.large"),
        (None, "AT76", "air.turboprop"),
        ("A0", "A320", "air.large"),
        ("", "a320", "air.large"),
        ("B3", "A320", "air.large"),
        ("B4", "A320", "air.large"),
        ("B4", None, "air.light"),
        ("A6", None, "air.high_performance"),
        ("A7", None, "air.rotorcraft"),
        ("B1", None, "air.glider"),
        ("B2", None, "air.balloon"),
        ("A2", None, "air.small"),
        ("A3", None, "air.large"),
        ("A4", None, "air.large"),
        ("A5", None, "air.heavy"),
        ("A4", "AT76", "air.turboprop"),
        ("A1", "A320", "air.large"),
        ("A3", "ZZZZ", "air.large"),
        ("A1", None, "air.light"),
        ("A0", "ZZZZ", "air.other"),
        ("A0", None, "air.other"),
        (None, None, "air.other"),
        ("B3", None, "air.other"),
    ],
)
def test_a_kind_of_aircraft_from_its_category_and_otherwise_its_type(category: str | None, type_code: str | None, expected: str) -> None:
    data = {key: value for key, value in (("category", category), ("t", type_code)) if value is not None}
    assert features_of([plane("4ca123", 0, 24.0, **data)], types=TYPES)[0]["properties"]["kind"] == expected


# A type's class from ICAO's description code and wake turbulence category, as tar1090's table writes them: rotorcraft,
# balloons and drones by their kind of aircraft, then heavy by wake, medium jets large, medium turboprops turboprop and
# other medium aircraft small, and light wake light. What the code can't tell, such as a tower (T0-), a ground vehicle
# (V0-) or a bare L0-, is none.
@pytest.mark.parametrize(
    ("code", "wake", "expected"),
    [
        ("H2T", "L", "air.rotorcraft"),
        ("H1P", "L", "air.rotorcraft"),
        ("G1P", "L", "air.rotorcraft"),
        # Tiltrotors, as the V-22 and the BA-609, and an electric one, the Joby JAS-4.
        ("R2T", "M", "air.rotorcraft"),
        ("R6E", "L", "air.rotorcraft"),
        # Balloons and airships (BALL, SHIP), and drones (DRON).
        ("B0-", "-", "air.balloon"),
        ("D0-", "-", "air.drone"),
        # Rotorcraft the table gives no wake: an unnamed helicopter (UHEL) or gyrocopter (GYRO).
        ("H0-", "-", "air.rotorcraft"),
        # A helicopter is a rotorcraft whatever its wake, and a medium jet large whatever it lands on (an amphibian).
        ("H2T", "M", "air.rotorcraft"),
        ("A2J", "M", "air.large"),
        ("G0-", "-", "air.rotorcraft"),
        # A seaplane is placed like a landplane.
        ("S2T", "M", "air.turboprop"),
        ("S1P", "L", "air.light"),
        ("T0-", "-", None),
        ("V0-", "-", None),
        ("P0-", "-", None),
        ("L0-", "-", None),
        ("L2J", "H", "air.heavy"),
        ("L4J", "J", "air.heavy"),
        ("L4T", "H", "air.heavy"),
        ("L2J", "M", "air.large"),
        ("L1J", "M", "air.large"),
        # Turboprops of medium wake, an ATR, a Dash 8 or a C-130, are turboprops, and heavy and light ones by wake.
        ("L2T", "M", "air.turboprop"),
        ("L4T", "M", "air.turboprop"),
        ("L1T", "L", "air.light"),
        ("L2T", "L", "air.light"),
        ("L2P", "M", "air.small"),
        ("L1P", "L", "air.light"),
        ("L1J", "L", "air.light"),
        ("A1P", "L", "air.light"),
        ("-0-", "-", None),
        ("L2J", "-", None),
        ("", "M", None),
    ],
)
def test_a_types_class_gives_its_kind(code: str, wake: str, expected: str | None) -> None:
    assert type_kind(code, wake) == expected


def test_the_type_table_keeps_the_types_that_get_a_kind() -> None:
    table = {
        "A320": ["AIRBUS A-320", "L2J", "M"],
        "R44": ["ROBINSON R-44 Raven", "H1P", "L"],
        "BALL": ["", "B0-", "-"],
        # A glider, an ultralight and a paraglider have no description their code tells, only their designators.
        "GLID": ["Glider", "L0-", "-"],
        "ULAC": ["", "L0-", "-"],
        "PARA": ["", "P0-", "-"],
        "TWR": ["", "T0-", "-"],
        "ZZZZ": ["", "-0-", "-"],
        "BAD1": "not a list",
        "BAD2": ["too short"],
        "BAD3": ["NUMBERS", 2, 3],
    }
    assert type_kinds(table) == {
        "A320": "air.large",
        "R44": "air.rotorcraft",
        "BALL": "air.balloon",
        "GLID": "air.glider",
        "ULAC": "air.light",
        "PARA": "air.light",
    }


def test_an_address_that_isnt_icaos_isnt_called_one() -> None:
    properties = features_of([plane("~2b0c4f", 0, 24.0)])[0]["properties"]
    assert properties["name"] == "~2B0C4F"
    assert properties["footer"] == "~2B0C4F"


def test_emergencies_and_military_aircraft_get_a_notice() -> None:
    assert notices(plane("1", 0, 24.0, squawk="7700", dbFlags=1), ENGLISH) == ["Emergency (7700)", "Military aircraft"]
    assert notices(plane("2", 0, 24.0, squawk="7600", dbFlags=2), ENGLISH) == ["Radio failure (7600)"]
    assert notices(plane("3", 0, 24.0, squawk="1200"), ENGLISH) == []


def test_colours_follow_the_altitude_on_tar1090s_scale() -> None:
    assert altitude_color(0, False) == "#f05a0f", "orange at the ground"
    assert altitude_color(-500, False) == "#f05a0f", "below the scale, its lowest colour"
    assert altitude_color(12000, False) == "#0cc35a", "green around 12 000 ft"
    assert altitude_color(40000, False) == "#ce0dce", "magenta at 40 000 ft"
    assert altitude_color(60000, False) == "#f11e1e", "above the scale, its highest colour"
    assert altitude_color(12000, True) == GROUND_COLOR
    assert altitude_color(None, False) == UNKNOWN_COLOR

    aircraft = [plane("a", 0, 24.0, alt_baro=12000), plane("b", 0, 24.1, alt_baro="ground"), plane("c", 0, 24.2)]
    trails = Trails()
    trails.update([plane("a", -15, 23.99, alt_baro=12000), aircraft[0]], now=0, minutes=5)
    features = build_features(measure(aircraft, RECEIVER_POSITION), trails, ENGLISH, "m", True, FEED_ID, {})
    colors = {feature["id"]: feature["properties"].get("color") for feature in features}
    assert colors == {"aircraft:a": "#0cc35a", "aircraft:a/trail": None, "aircraft:b": GROUND_COLOR, "aircraft:c": UNKNOWN_COLOR}, (
        "a trail takes its aircraft's colour through `point`"
    )


def test_the_legend_is_in_the_receivers_unit_with_a_kilometre_and_up_in_kilometres() -> None:
    metres = legend("m", FINNISH, False)
    assert metres[0] == {"color": GROUND_COLOR, "label": "Maassa"}
    assert [entry["label"] for entry in metres[1:]] == ["300 m", "1 km", "2 km", "3 km", "6 km", "9 km", "12 km"]
    assert metres[1]["color"] == altitude_color(300 / 0.3048, False)
    assert metres[-1]["color"] == altitude_color(12000 / 0.3048, False)
    feet = legend("ft", ENGLISH, False)
    assert feet[0]["label"] == "On the ground"
    assert [entry["label"] for entry in feet[1:]] == [
        "1,000 ft",
        "3,000 ft",
        "6,000 ft",
        "10,000 ft",
        "20,000 ft",
        "30,000 ft",
        "40,000 ft",
    ]
    assert feet[-1]["color"] == altitude_color(40000, False)
    unknown = legend("m", FINNISH, True)
    assert unknown[:-1] == metres
    assert unknown[-1] == {"color": UNKNOWN_COLOR, "label": "Korkeus tuntematon"}, "only while some aircraft has no altitude"


def test_trails_follow_an_aircraft_and_end_with_its_minutes() -> None:
    trails = Trails()
    trails.update([plane("a", 1000, 24.00)], now=1000, minutes=5)
    assert trails.line("a") is None, "one position isn't a line"

    trails.update([plane("a", 1015, 24.01)], now=1015, minutes=5)
    trails.update([plane("a", 1015, 24.01)], now=1030, minutes=5)
    assert trails.line("a") == [[24.0, 61.5], [24.01, 61.5]], "a position isn't added twice"

    # Straight on: the middle point adds nothing to the line.
    trails.update([plane("a", 1030, 24.02)], now=1030, minutes=5)
    assert trails.line("a") == [[24.0, 61.5], [24.02, 61.5]]

    features = build_features(measure([plane("a", 1030, 24.02)], RECEIVER_POSITION), trails, ENGLISH, "m", False, FEED_ID, {})
    assert features[1] == {
        "type": "Feature",
        "id": "aircraft:a/trail",
        "geometry": {"type": "LineString", "coordinates": [[24.0, 61.5], [24.02, 61.5]]},
        "properties": {"kind": "air.other", "point": "aircraft:a"},
    }

    trails.update([], now=1320, minutes=5)
    assert trails.line("a") is None, "older positions drop off"
    trails.update([], now=1400, minutes=5)
    assert "a" not in trails.points, "an aircraft gone for the trail's minutes is forgotten"


def test_receiver_health_from_its_statistics() -> None:
    assert receiver_health(stats()) == {
        "aircraft_tracked": 4,
        "aircraft_with_position": 3,
        "messages_per_second": 25.1,
        "positions_per_minute": 48,
        "max_range": 187.7,
        "signal": -21.4,
        "noise": -38.2,
    }


MISSING = object()


@pytest.mark.parametrize(
    ("with_pos", "without_pos", "tracked"),
    [
        (3, 1, 4),
        (0, 0, 0),
        (3.0, 1.0, 4),
        (3, MISSING, None),
        (MISSING, 1, None),
        (MISSING, MISSING, None),
        (3, None, None),
        (None, 1, None),
        (3, "1", None),
        ("3", 1, None),
    ],
)
def test_aircraft_tracked_is_unknown_without_both_counts(with_pos: Any, without_pos: Any, tracked: int | None) -> None:
    """readsb counts the aircraft with a position and those without apart, and a total from one of them would be too low.

    A count that is missing, null or not a number leaves the total unknown, and the other values as they were.
    """
    counts = {"aircraft_with_pos": with_pos, "aircraft_without_pos": without_pos}
    partial = {key: value for key, value in stats().items() if key not in counts}
    partial.update({key: value for key, value in counts.items() if value is not MISSING})
    with_position = with_pos if isinstance(with_pos, (int, float)) and not isinstance(with_pos, bool) else None
    expected = {**receiver_health(stats()), "aircraft_tracked": tracked}
    expected["aircraft_with_position"] = int(with_position) if with_position is not None else None
    assert receiver_health(partial) == expected


def test_a_networked_receiver_has_no_signal_or_noise() -> None:
    networked = {**stats(), "last1min": {key: value for key, value in stats()["last1min"].items() if key != "local"}}
    health = receiver_health(networked)
    assert health["signal"] is None
    assert health["noise"] is None
    assert health["messages_per_second"] == 25.1


def test_a_minute_without_messages_has_no_signal() -> None:
    minute = {**stats()["last1min"], "local": {"noise": -40.1}, "messages_valid": 0, "position_count_total": 0}
    health = receiver_health({**stats(), "last1min": minute})
    assert health["signal"] is None
    assert health["noise"] == -40.1
    assert health["messages_per_second"] == 0


def test_every_language_has_the_same_texts_as_english() -> None:
    folder = COMPONENT_DIR / "texts"
    english = json.loads((folder / "en.json").read_text(encoding="utf-8"))
    for path in folder.glob("*.json"):
        texts = json.loads(path.read_text(encoding="utf-8"))
        assert texts.keys() == english.keys(), path.name
        for key, text in texts.items():
            assert set(PLACEHOLDER.findall(text)) == set(PLACEHOLDER.findall(english[key])), f"{path.name}: {key}"


def keys(value: Any, prefix: str = "") -> set[str]:
    """Every key path in nested dictionaries, such as config.step.user.data.url."""
    if not isinstance(value, dict):
        return {prefix}
    return set().union(*(keys(child, f"{prefix}.{key}" if prefix else key) for key, child in value.items()))


def test_every_ui_language_has_the_same_keys_as_english() -> None:
    folder = COMPONENT_DIR / "translations"
    english = keys(json.loads((folder / "en.json").read_text(encoding="utf-8")))
    for path in folder.glob("*.json"):
        assert keys(json.loads(path.read_text(encoding="utf-8"))) == english, path.name


def test_the_feed_languages_agree_everywhere() -> None:
    """LANGUAGES, the language selector and the texts/ files list the same languages."""
    english = keys(json.loads((COMPONENT_DIR / "translations" / "en.json").read_text(encoding="utf-8")))
    selector = {key.removeprefix("selector.language.options.") for key in english if key.startswith("selector.language.")}
    files = {path.stem for path in (COMPONENT_DIR / "texts").glob("*.json")}
    assert selector == set(LANGUAGES) == files


def test_a_language_may_write_numbers_without_a_thousands_separator() -> None:
    texts = Texts({"thousands_separator": "", "decimal_separator": ","})
    assert texts.number(33000) == "33000"
    assert texts.number(2.5, 1) == "2,5"


def test_an_address_keeps_its_path_and_loses_the_case_of_its_host() -> None:
    assert normalize_url(" HTTP://Receiver.Example:8080/Tar1090/data/ ") == "http://receiver.example:8080/Tar1090"
    assert normalize_url("http://receiver.example:8080") == "http://receiver.example:8080"
    assert normalize_url("http://Adsb:S3cret@Receiver.Example/tar1090") == "http://Adsb:S3cret@receiver.example/tar1090", (
        "a login keeps its case"
    )
    assert normalize_url("http://[FE80::1]:8080/") == "http://[fe80::1]:8080"
    assert normalize_url("http://receiver.example/tar1090/?icao=4ca123#map") == "http://receiver.example/tar1090", (
        "an address copied with an aircraft selected"
    )
    assert without_login("http://adsb:S3cret@receiver.example/tar1090") == "http://receiver.example/tar1090"


def test_an_aircraft_list_that_isnt_a_list_is_refused() -> None:
    with pytest.raises(ValueError):
        parse_aircraft({"now": 0, "aircraft": {"hex": "46a1b2"}})
    with pytest.raises(ValueError):
        parse_aircraft({"now": 0, "ac": "nothing"}, remote=True)


def test_the_distance_to_a_route_is_to_its_nearest_point_between_its_ends() -> None:
    tampere, helsinki = (61.414, 23.604), (60.317, 24.963)
    halfway = (60.9, 24.3)
    assert distance_to_leg_km(halfway, tampere, helsinki) < 5, "on the line"
    assert 40 < distance_to_leg_km((60.9, 25.2), tampere, helsinki) < 60, "beside it"
    behind = (62.0, 22.9)
    assert distance_to_leg_km(behind, tampere, helsinki) == pytest.approx(haversine_km(*behind, *tampere)), "behind the start"
    past = (59.8, 25.6)
    assert distance_to_leg_km(past, tampere, helsinki) == pytest.approx(haversine_km(*past, *helsinki)), "past the end"
    assert distance_to_leg_km(tampere, tampere, helsinki) == 0
    assert distance_to_leg_km(halfway, tampere, tampere) == pytest.approx(haversine_km(*halfway, *tampere)), "a route of one airport"
