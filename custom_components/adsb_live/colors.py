"""Colours by altitude, on tar1090's scale, so a map reads like the one ADS-B users already know.

The hue follows the altitude from orange near the ground through yellow and green to
magenta at 40 000 ft and red from 51 000 ft up, and the lightness follows the hue,
which keeps the colours equally easy to see. Aircraft on the ground are dark grey,
and those without an altitude light grey.
"""

from __future__ import annotations

import colorsys
from bisect import bisect_right
from collections.abc import Sequence

from .geo import METRES_PER_FOOT
from .texts import Texts

# (altitude in feet, hue in degrees)
HUES = ((0, 20), (2000, 32.5), (4000, 43), (6000, 54), (8000, 72), (9000, 85), (11000, 140), (40000, 300), (51000, 360))
# (hue in degrees, lightness in per cent)
LIGHTNESS = (
    (0, 53), (20, 50), (32, 54), (40, 52), (46, 51), (50, 46), (60, 43), (80, 41), (100, 41), (120, 41), (140, 41),
    (160, 40), (180, 40), (190, 44), (198, 50), (200, 58), (220, 58), (240, 58), (255, 55), (266, 55), (270, 58),
    (280, 58), (290, 47), (300, 43), (310, 48), (320, 48), (340, 52), (360, 53),
)  # fmt: skip
SATURATION = 88
GROUND_COLOR = "#4d4d4d"
UNKNOWN_COLOR = "#bfbfbf"

# The altitudes the legend shows, in each unit.
LEGEND_ALTITUDES = {"m": (300, 1000, 2000, 3000, 6000, 9000, 12000), "ft": (1000, 3000, 6000, 10000, 20000, 30000, 40000)}


def _interpolate(points: Sequence[tuple[float, float]], x: float) -> float:
    """Linear between the points, and the first or last value beyond them."""
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    index = bisect_right([point[0] for point in points], x)
    (x0, y0), (x1, y1) = points[index - 1], points[index]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def altitude_color(altitude_ft: float | None, on_ground: bool) -> str:
    """A CSS hex colour for an altitude in feet."""
    if on_ground:
        return GROUND_COLOR
    if altitude_ft is None:
        return UNKNOWN_COLOR
    hue = _interpolate(HUES, altitude_ft)
    lightness = _interpolate(LIGHTNESS, hue)
    red, green, blue = colorsys.hls_to_rgb(hue / 360, lightness / 100, SATURATION / 100)
    return f"#{round(red * 255):02x}{round(green * 255):02x}{round(blue * 255):02x}"


def legend(unit: str, texts: Texts, unknown_altitude: bool) -> list[dict[str, str]]:
    """The feed's `legend`: the ground and a few altitudes in the receiver's unit, lowest first.

    The colour of an unknown altitude is explained only while some aircraft in the feed has one.
    """
    entries = [{"color": GROUND_COLOR, "label": texts("legend_ground")}]
    for altitude in LEGEND_ALTITUDES[unit]:
        feet = altitude / METRES_PER_FOOT if unit == "m" else altitude
        entries.append({"color": altitude_color(feet, False), "label": _legend_label(altitude, unit, texts)})
    if unknown_altitude:
        entries.append({"color": UNKNOWN_COLOR, "label": texts("legend_unknown")})
    return entries


def _legend_label(altitude: int, unit: str, texts: Texts) -> str:
    """A kilometre and up in kilometres, which keeps the legend on one line on a map of ordinary width."""
    if unit == "m" and altitude >= 1000:
        return f"{texts.number(altitude / 1000)} km"
    return f"{texts.number(altitude)} {unit}"
