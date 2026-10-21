"""Constants for the ADS-B Live integration."""

from typing import Final

DOMAIN: Final = "adsb_live"

# Version of the Map Feed format the feed sensors write (docs/map-feed-format.md in map-feed-card).
MAP_FEED_VERSION: Final = 1

# Credit on the map when a feed uses adsb.fi, as its terms ask.
ADSB_FI_ATTRIBUTION: Final = "adsb.fi"
# adsb.fi's terms ask for a link to its home page with the credit.
ADSB_FI_ATTRIBUTION_URL: Final = "https://adsb.fi/"

# Languages for the texts the integration writes into feeds. Each needs a texts/<code>.json file.
LANGUAGES: Final = ["fi", "en"]

# Config entry: one receiver
CONF_LANGUAGE: Final = "language"
CONF_ALTITUDE_UNIT: Final = "altitude_unit"

# Units for altitudes and vertical rates in feeds: metres and m/s, or feet and ft/min, as aviation uses.
ALTITUDE_UNITS: Final = ["m", "ft"]
# Also for an entry saved without the setting.
DEFAULT_ALTITUDE_UNIT: Final = "m"

# Feed type (config subentry type)
SUBENTRY_FEED: Final = "feed"

# Feed settings (config subentry data)
CONF_AREA: Final = "area"
CONF_ADSB_FI: Final = "adsb_fi"
CONF_REFRESH_SECONDS: Final = "refresh_seconds"
CONF_TRAIL_MINUTES: Final = "trail_minutes"
CONF_COLOR_BY_ALTITUDE: Final = "color_by_altitude"
# Also for a feed saved without the setting.
DEFAULT_COLOR_BY_ALTITUDE: Final = True
# Overhead: within this radius of the area's centre and below this altitude. A radius of 0 turns it off. The altitude
# is stored in the unit it was entered in, with that unit, so it is compared as it was entered.
CONF_OVERHEAD_RADIUS: Final = "overhead_radius_km"
CONF_OVERHEAD_ALTITUDE: Final = "overhead_altitude"
CONF_OVERHEAD_ALTITUDE_UNIT: Final = "overhead_altitude_unit"
DEFAULT_OVERHEAD_RADIUS_KM: Final = 5
# By the receiver's unit for a new feed. A feed saved without the settings has 1 500 m.
DEFAULT_OVERHEAD_ALTITUDE: Final = {"m": 1500, "ft": 5000}
MAX_OVERHEAD_RADIUS_KM: Final = 50

# The detail action that feeds name for each aircraft.
SERVICE_GET_AIRCRAFT_DETAILS: Final = "get_aircraft_details"
ATTR_FEED: Final = "feed"
ATTR_HEX: Final = "hex"

# The map feed format allows live vehicle positions every 15 seconds.
MIN_REFRESH_SECONDS: Final = 15
DEFAULT_REFRESH_SECONDS: Final = 15
DEFAULT_TRAIL_MINUTES: Final = 5
MAX_TRAIL_MINUTES: Final = 30
DEFAULT_RADIUS_M: Final = 100_000

# readsb writes its statistics once a minute.
STATS_REFRESH_SECONDS: Final = 60
