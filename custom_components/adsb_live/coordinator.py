"""Update coordinators: the receiver's statistics, and one per feed (config subentry)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .aircraft import Aircraft, FeedConfig, Trails, build_features, in_area, merge, number, parse_aircraft
from .api import AdsbError, AdsbFiClient, ReceiverClient
from .const import CONF_REFRESH_SECONDS, DOMAIN, STATS_REFRESH_SECONDS
from .health import receiver_health
from .texts import Texts

_LOGGER = logging.getLogger(__name__)

# readsb writes aircraft.json every second and stats.json every minute. When it stops, it deletes only
# receiver.json, and the web server goes on serving the last of the others. Older than this, they are stale.
# The margins leave room for the receiver's clock to differ from Home Assistant's.
AIRCRAFT_MAX_AGE_SECONDS = 120
STATS_MAX_AGE_SECONDS = 180


def check_written_lately(data: dict[str, Any], max_age_seconds: float, name: str) -> None:
    """Raises UpdateFailed when readsb hasn't written the file in `max_age_seconds`, by the time in it."""
    written = number(data.get("now"))
    if written is None:
        raise UpdateFailed(f"No time in the receiver's {name}")
    age = dt_util.utcnow().timestamp() - written
    if age > max_age_seconds:
        raise UpdateFailed(f"The receiver's {name} was last written {round(age)} s ago, so readsb may have stopped")


@dataclass(frozen=True)
class Receiver:
    url: str
    # readsb's version, and the receiver's position when it has been set (latitude, longitude).
    version: str | None
    position: tuple[float, float] | None

    @classmethod
    def from_json(cls, url: str, data: dict[str, Any]) -> Receiver:
        latitude, longitude = number(data.get("lat")), number(data.get("lon"))
        position = (latitude, longitude) if latitude is not None and longitude is not None else None
        version = data.get("version")
        return cls(url, str(version).split(" ")[0] if version else None, position)


@dataclass
class AdsbRuntimeData:
    receiver_client: ReceiverClient
    adsb_fi: AdsbFiClient
    receiver: Receiver
    texts: Texts
    # "m" or "ft", for altitudes and vertical rates in the feeds.
    altitude_unit: str
    stats: StatsCoordinator
    feeds: dict[str, FeedCoordinator] = field(default_factory=dict)


type AdsbConfigEntry = ConfigEntry[AdsbRuntimeData]


class StatsCoordinator(DataUpdateCoordinator[dict[str, float | None]]):
    """The receiver's health from stats.json."""

    config_entry: AdsbConfigEntry

    def __init__(self, hass: HomeAssistant, entry: AdsbConfigEntry, client: ReceiverClient, url: str) -> None:
        super().__init__(
            hass, _LOGGER, config_entry=entry, name=f"{DOMAIN} {entry.title}", update_interval=timedelta(seconds=STATS_REFRESH_SECONDS)
        )
        self._client = client
        self._url = url

    async def _async_update_data(self) -> dict[str, float | None]:
        try:
            stats = await self._client.stats(self._url)
        except AdsbError as err:
            raise UpdateFailed(str(err)) from err
        check_written_lately(stats, STATS_MAX_AGE_SECONDS, "stats.json")
        return receiver_health(stats)


@dataclass(frozen=True)
class FeedData:
    features: list[dict[str, Any]]
    updated: datetime
    count: int
    # Whether some aircraft in the feed has no altitude, which the legend then explains.
    unknown_altitude: bool


class FeedCoordinator(DataUpdateCoordinator[FeedData]):
    """The aircraft in one feed's area, from the receiver and optionally adsb.fi."""

    config_entry: AdsbConfigEntry

    def __init__(self, hass: HomeAssistant, entry: AdsbConfigEntry, subentry: ConfigSubentry) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} {subentry.title}",
            update_interval=timedelta(seconds=subentry.data[CONF_REFRESH_SECONDS]),
        )
        self.subentry = subentry
        self.feed_config = FeedConfig.from_data(subentry.data)
        self._trails = Trails()
        self._adsb_fi_failing = False

    @property
    def runtime(self) -> AdsbRuntimeData:
        return self.config_entry.runtime_data

    async def _async_update_data(self) -> FeedData:
        runtime = self.runtime
        config = self.feed_config
        try:
            data = await runtime.receiver_client.aircraft(runtime.receiver.url)
            check_written_lately(data, AIRCRAFT_MAX_AGE_SECONDS, "aircraft.json")
            # A file that isn't readsb's aircraft list makes the feed unavailable, like a failed request.
            local = parse_aircraft(data)
        except (AdsbError, ValueError) as err:
            raise UpdateFailed(str(err)) from err

        aircraft = merge(local, await self._adsb_fi(runtime.adsb_fi)) if config.adsb_fi else local
        aircraft = in_area(aircraft, config.area)
        now = dt_util.utcnow()
        trails = None
        if config.trail_minutes > 0:
            self._trails.update(aircraft, now.timestamp(), config.trail_minutes)
            trails = self._trails
        distance_from = runtime.receiver.position or (config.area.latitude, config.area.longitude)
        return FeedData(
            build_features(aircraft, distance_from, trails, runtime.texts, runtime.altitude_unit, config.color_by_altitude),
            now,
            len(aircraft),
            any(plane.altitude_ft is None for plane in aircraft),
        )

    async def _adsb_fi(self, client: AdsbFiClient) -> list[Aircraft]:
        """adsb.fi's aircraft in the area. A failure only leaves them out: the receiver's own still show.

        The client comes from the runtime read before the update's first wait. A refresh asked for outside
        the schedule, such as with homeassistant.update_entity, isn't cancelled when the entry unloads, and
        the unload takes the entry's runtime away while the refresh is still waiting.
        """
        area = self.feed_config.area
        try:
            aircraft = parse_aircraft(await client.aircraft_near(area.latitude, area.longitude, area.radius_km), remote=True)
        except (AdsbError, ValueError) as err:
            # A warning when the feed's outage starts, so a lasting one shows in the log without filling it.
            log = _LOGGER.debug if self._adsb_fi_failing else _LOGGER.warning
            log("Fetching aircraft from adsb.fi for %s failed, showing the receiver's own: %s", self.subentry.title, err)
            self._adsb_fi_failing = True
            return []
        if self._adsb_fi_failing:
            _LOGGER.info("Fetching aircraft from adsb.fi for %s works again", self.subentry.title)
            self._adsb_fi_failing = False
        return aircraft
