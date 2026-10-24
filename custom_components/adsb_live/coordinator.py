"""Update coordinators for the receiver's statistics and each feed, and a reader of the receiver's own aircraft for its list."""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from time import monotonic
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .aircraft import (
    Aircraft,
    FeedConfig,
    Positions,
    Trails,
    aircraft_name,
    build_features,
    emergency_squawk,
    heading,
    heard_aircraft,
    in_area,
    is_military,
    is_overhead,
    measure,
    number,
    parse_aircraft,
    type_kinds,
    updates_to_hold,
)
from .api import AdsbError, AdsbFiClient, DetailsClient, ReceiverClient
from .const import CONF_REFRESH_SECONDS, DOMAIN, STATS_REFRESH_SECONDS
from .geo import METRES_PER_FOOT
from .health import receiver_health
from .texts import Texts

_LOGGER = logging.getLogger(__name__)

# readsb writes aircraft.json every second and stats.json every minute. When it stops, it deletes only
# receiver.json, and the web server goes on serving the last of the others. Older than this, they are stale.
# The margins leave room for the receiver's clock to differ from Home Assistant's.
AIRCRAFT_MAX_AGE_SECONDS = 120
STATS_MAX_AGE_SECONDS = 180

# An aircraft that leaves an event's state, or drops out of the feed, for this long, or for two updates when they take
# longer, fires the event again when it comes back. Shorter gaps, such as an update it missed at the edge of coverage
# or one that failed, don't count as leaving.
EVENT_REARM_SECONDS = 10 * 60

# The receiver's own aircraft are read for its list only when someone has the list open, and an answer is kept this
# long, so that dashboards open side by side ask readsb once. readsb writes aircraft.json every second.
HEARD_CACHE_SECONDS = 5

# tar1090's table of aircraft types changes only with ultrafeeder's database, so it is read again once a day, and an hour
# after it couldn't be read, as when the receiver has no tar1090.
TYPES_REFRESH_SECONDS = 24 * 3600
TYPES_RETRY_SECONDS = 3600
EVENT_TYPES = ("emergency", "military", "overhead")


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
    details: DetailsClient
    receiver: Receiver
    texts: Texts
    # "m" or "ft", for altitudes and vertical rates in the feeds.
    altitude_unit: str
    stats: StatsCoordinator
    heard: ReceiverAircraft
    types: TypeKinds
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


class ReceiverAircraft:
    """The receiver's own aircraft for its list, read from aircraft.json when asked, as the action get_receiver_aircraft answers."""

    def __init__(self, client: ReceiverClient, url: str, unit: str) -> None:
        self._client = client
        self._url = url
        self._unit = unit
        self._lock = asyncio.Lock()
        self._answer: dict[str, Any] | None = None
        self._read_at = 0.0

    async def get(self) -> dict[str, Any]:
        """{"aircraft": [...], "altitude_unit": unit}. Raises AdsbError, UpdateFailed or ValueError when it can't be read."""
        async with self._lock:
            if self._answer is not None and monotonic() - self._read_at < HEARD_CACHE_SECONDS:
                return self._answer
            data = await self._client.aircraft(self._url)
            check_written_lately(data, AIRCRAFT_MAX_AGE_SECONDS, "aircraft.json")
            self._answer = {"aircraft": heard_aircraft(data, self._unit), "altitude_unit": self._unit}
            # From the answer, so that a call waiting behind a slow read gets that read's answer.
            self._read_at = monotonic()
            return self._answer


class TypeKinds:
    """Each aircraft type's kind from the table tar1090 serves (see type_kinds), which wins over all but EXACT_CATEGORIES.

    Without the table, as without tar1090, there are none, and every aircraft has its category's kind.
    """

    def __init__(self, client: ReceiverClient, url: str) -> None:
        self._client = client
        self._url = url
        self._lock = asyncio.Lock()
        self._kinds: dict[str, str] = {}
        self._next_read = 0.0

    async def get(self) -> dict[str, str]:
        async with self._lock:
            if monotonic() >= self._next_read:
                try:
                    self._kinds = type_kinds(await self._client.type_table(self._url))
                    self._next_read = monotonic() + TYPES_REFRESH_SECONDS
                except AdsbError as err:
                    _LOGGER.debug("No table of aircraft types from the receiver: %s", err)
                    self._next_read = monotonic() + TYPES_RETRY_SECONDS
            return self._kinds


@dataclass(frozen=True)
class AircraftEvent:
    # One of EVENT_TYPES.
    type: str
    data: dict[str, Any]


@dataclass(frozen=True)
class FeedData:
    features: list[dict[str, Any]]
    updated: datetime
    count: int
    # Whether some aircraft in the feed has no altitude, which the legend then explains.
    unknown_altitude: bool
    # Every aircraft in the feed by its address, with its distance in km, for the details on tap.
    aircraft: dict[str, tuple[float, Aircraft]] = field(default_factory=dict)
    # The nearest aircraft in the air, with its distance, or None.
    nearest: tuple[float, Aircraft] | None = None
    # What happened in this update: aircraft that entered an event's state.
    events: list[AircraftEvent] = field(default_factory=list)


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
        self._positions = Positions(updates_to_hold(subentry.data[CONF_REFRESH_SECONDS]))
        self._trails = Trails()
        self._adsb_fi_failing = False
        # For each event type, the aircraft in its state, by when they were last seen in it.
        self._in_state: dict[str, dict[str, float]] = {event_type: {} for event_type in EVENT_TYPES}

    @property
    def runtime(self) -> AdsbRuntimeData:
        return self.config_entry.runtime_data

    @property
    def device_info(self) -> DeviceInfo:
        """The feed's device, which its entities share."""
        return DeviceInfo(identifiers={(DOMAIN, self.subentry.subentry_id)}, name=self.subentry.title, entry_type=DeviceEntryType.SERVICE)

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

        # The receiver's own first, so that it wins over adsb.fi when both have a believable position.
        candidates = [*local, *await self._adsb_fi(runtime.adsb_fi)] if config.adsb_fi else local
        # Before the area, so that a false position doesn't take one of the receiver's own aircraft out of it. adsb.fi's
        # answer has only what it places within the area, false or not.
        aircraft = in_area(self._positions.check(candidates), config.area)
        now = dt_util.utcnow()
        trails = None
        if config.trail_minutes > 0:
            self._trails.update(aircraft, now.timestamp(), config.trail_minutes)
            trails = self._trails
        distance_from = runtime.receiver.position or (config.area.latitude, config.area.longitude)
        measured = measure(aircraft, distance_from)
        types = await runtime.types.get()
        return FeedData(
            build_features(
                measured, trails, runtime.texts, runtime.altitude_unit, config.color_by_altitude, self.subentry.subentry_id, types
            ),
            now,
            len(aircraft),
            any(plane.altitude_ft is None for plane in aircraft),
            aircraft={plane.hex: (distance_km, plane) for distance_km, plane in measured},
            nearest=next(((distance_km, plane) for distance_km, plane in measured if not plane.on_ground), None),
            events=self._new_events(measured, now.timestamp()),
        )

    def _new_events(self, measured: list[tuple[float, Aircraft]], now: float) -> list[AircraftEvent]:
        """The aircraft that entered each event's state since they were last in it, nearest first."""
        # The gap is measured from the last update that saw the aircraft in the state, and updates come a whole
        # interval apart: one missed update is a gap of two intervals, two missed ones three. The limit is the whole
        # updates that cover the rearm time, and half an interval more, so it falls between two updates, never on one.
        interval = self.update_interval.total_seconds()
        rearm = (math.ceil(max(EVENT_REARM_SECONDS, 2 * interval) / interval) + 0.5) * interval
        events = []
        for distance_km, plane in measured:
            states = {
                "emergency": emergency_squawk(plane) is not None,
                "military": is_military(plane),
                "overhead": is_overhead(plane, self.feed_config),
            }
            for event_type, entered in states.items():
                if not entered:
                    continue
                # Checked here, not only by the pruning below, which runs only when an update succeeds.
                last = self._in_state[event_type].get(plane.hex)
                if last is None or now - last > rearm:
                    events.append(AircraftEvent(event_type, self.event_data(plane, distance_km)))
                self._in_state[event_type][plane.hex] = now
        # Forgetting what is old enough to fire again keeps the memory to the aircraft seen lately.
        for seen in self._in_state.values():
            for hex_code in [hex_code for hex_code, last in seen.items() if now - last > rearm]:
                del seen[hex_code]
        return events

    def event_data(self, plane: Aircraft, distance_km: float) -> dict[str, Any]:
        """What an event tells about its aircraft, the altitude in the receiver's unit."""
        data = plane.data
        altitude = plane.altitude_ft
        if altitude is not None and self.runtime.altitude_unit == "m":
            altitude = round(altitude * METRES_PER_FOOT)
        values = {
            "hex": plane.hex,
            "name": aircraft_name(plane),
            "callsign": plane.callsign,
            "registration": data.get("r"),
            "type": data.get("t"),
            "squawk": data.get("squawk"),
            "military": is_military(plane),
            "distance_km": round(distance_km, 1),
            "altitude": altitude,
            "heading": heading(plane),
            "latitude": plane.latitude,
            "longitude": plane.longitude,
        }
        return {key: value for key, value in values.items() if value not in (None, "")}

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
