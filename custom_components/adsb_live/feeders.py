"""Other feeders' status: Flightradar24's fr24feed and FlightAware's piaware on your network, adsb.fi and adsb.lol online.

A feeder is a config subentry of the receiver it feeds from, a device under the
receiver's with a connection sensor and one sensor for what the feeder reports.
fr24feed and piaware are asked on their own web servers. adsb.fi and adsb.lol
are asked what they receive from the address Home Assistant's request comes from,
which is the receiver's only when both reach the internet through the same address.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, Any

import aiohttp
from homeassistant.config_entries import ConfigSubentry
from homeassistant.const import CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import AdsbError, get_json, normalize_url, without_login
from .const import DOMAIN

if TYPE_CHECKING:
    from .coordinator import AdsbConfigEntry

_LOGGER = logging.getLogger(__name__)

# The feeder's kind, in the subentry's data.
CONF_KIND = "kind"

ADSB_FI_MYIP = "https://api.adsb.fi/v1/myip"
ADSB_LOL_ME = "https://api.adsb.lol/0/me"

# piaware writes status.json every few seconds, and the web server goes on serving the last one after piaware stops.
# Older than this, piaware has stopped. The margin leaves room for its machine's clock to differ from Home Assistant's.
PIAWARE_MAX_AGE_SECONDS = 120

# piaware's MLAT status by its colour: green when synchronised, amber while starting or out of sync with the receivers
# near it, red when MLAT is off or its client isn't running.
PIAWARE_MLAT = {"green": "synchronized", "amber": "not_synchronized", "red": "off"}
MLAT_STATES = list(PIAWARE_MLAT.values())


@dataclass(frozen=True)
class FeederStatus:
    connected: bool
    # What the kind's detail sensor shows: the aircraft reported, MLAT's peers or MLAT's state. None when the feeder
    # reports none, as adsb.fi and adsb.lol do for a feeder without MLAT.
    detail: int | str | None


def _count(value: Any) -> int | None:
    """A whole number, also one sent as text as fr24feed and adsb.fi send theirs."""
    if isinstance(value, bool):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _first(items: Any) -> Mapping[str, Any]:
    """The first of a list of connections, or nothing. Several feeders behind one address are listed together."""
    return items[0] if isinstance(items, list) and items and isinstance(items[0], Mapping) else {}


def flightradar24_status(data: Mapping[str, Any]) -> FeederStatus:
    """From fr24feed's monitor.json. Nothing answers while fr24feed is stopped, as it serves the file itself."""
    if "feed_status" not in data:
        raise UpdateFailed("Unexpected answer from Flightradar24: no feed_status")
    return FeederStatus(data["feed_status"] == "connected", _count(data.get("feed_num_ac_tracked")))


def flightaware_status(data: Mapping[str, Any]) -> FeederStatus:
    """From piaware's status.json: connected while logged in to FlightAware, with MLAT's state."""
    written_ms = data.get("time")
    if not isinstance(written_ms, (int, float)) or isinstance(written_ms, bool):
        raise UpdateFailed("Unexpected answer from FlightAware: no time")
    age = dt_util.utcnow().timestamp() - written_ms / 1000
    if age > PIAWARE_MAX_AGE_SECONDS:
        raise UpdateFailed(f"FlightAware's status.json was last written {round(age)} s ago, so piaware may have stopped")
    adept = data.get("adept")
    mlat = data.get("mlat")
    connected = isinstance(adept, Mapping) and adept.get("status") == "green"
    return FeederStatus(connected, PIAWARE_MLAT.get(mlat.get("status")) if isinstance(mlat, Mapping) else None)


def _beast(data: Any, name: str) -> list[Any]:
    """The feeds the service receives from this address, an empty list when none."""
    beast = data.get("beast") if isinstance(data, Mapping) else None
    if not isinstance(beast, list):
        raise UpdateFailed(f"Unexpected answer from {name}: no list of feeds")
    return beast


def adsb_fi_status(data: Mapping[str, Any]) -> FeederStatus:
    """From adsb.fi's /v1/myip: connected while it receives a feed from this address."""
    return FeederStatus(bool(_beast(data, "adsb.fi")), _count(_first(data.get("mlat")).get("peerCount")))


def adsb_lol_status(data: Mapping[str, Any]) -> FeederStatus:
    """From adsb.lol's /0/me, which names its fields differently from adsb.fi's."""
    clients = data.get("clients")
    beast = _beast(clients, "adsb.lol")
    return FeederStatus(bool(beast), _count(_first(clients.get("mlat")).get("peer_count")))


@dataclass(frozen=True)
class FeederKind:
    # The device's name and manufacturer, and the name errors give.
    name: str
    status: Callable[[Mapping[str, Any]], FeederStatus]
    refresh_seconds: int
    # The detail sensor's translation key.
    detail: str
    # A feeder on your network has an address, and its file under it. One online is asked at its fixed address.
    file: str | None = None
    address: str | None = None


FEEDER_KINDS: dict[str, FeederKind] = {
    "flightradar24": FeederKind("Flightradar24", flightradar24_status, 60, "reported_aircraft", file="monitor.json"),
    "flightaware": FeederKind("FlightAware", flightaware_status, 60, "mlat_status", file="status.json"),
    "adsb_fi": FeederKind("adsb.fi", adsb_fi_status, 120, "mlat_peers", address=ADSB_FI_MYIP),
    # adsb.lol allows 500 requests a day to /0/me from an address. Every 2 minutes is 720, every 5 minutes 288.
    "adsb_lol": FeederKind("adsb.lol", adsb_lol_status, 300, "mlat_peers", address=ADSB_LOL_ME),
}


def feeder_url(url: str, file: str) -> str:
    """The feeder's web server as typed, also when the file's address was pasted instead."""
    return normalize_url(url).removesuffix(f"/{file}")


async def fetch_status(session: aiohttp.ClientSession, kind: FeederKind, url: str | None, user_agent: str) -> FeederStatus:
    """The feeder's status. Raises UpdateFailed when it can't be read."""
    # Named by the kind, so an address with a login never reaches the log.
    address = f"{url}/{kind.file}" if kind.file else kind.address
    headers = None if kind.file else {"User-Agent": user_agent}
    try:
        data = await get_json(session, address or "", headers, name=kind.name)
    except AdsbError as err:
        raise UpdateFailed(str(err)) from err
    return kind.status(data)


class FeederCoordinator(DataUpdateCoordinator[FeederStatus]):
    config_entry: AdsbConfigEntry

    def __init__(
        self, hass: HomeAssistant, entry: AdsbConfigEntry, subentry: ConfigSubentry, session: aiohttp.ClientSession, user_agent: str
    ) -> None:
        self.kind = FEEDER_KINDS[subentry.data[CONF_KIND]]
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} {subentry.title}",
            update_interval=timedelta(seconds=self.kind.refresh_seconds),
        )
        self.subentry = subentry
        self._session = session
        self._user_agent = user_agent
        self._url: str | None = subentry.data.get(CONF_URL)

    @property
    def device_info(self) -> DeviceInfo:
        """The feeder's device, under the receiver's, which the receiver card finds its feeders by."""
        return DeviceInfo(
            identifiers={(DOMAIN, self.subentry.subentry_id)},
            name=self.subentry.title,
            manufacturer=self.kind.name,
            via_device_id=self.config_entry.runtime_data.receiver_device_id,
            entry_type=None if self._url else DeviceEntryType.SERVICE,
            configuration_url=without_login(self._url) if self._url else None,
        )

    async def _async_update_data(self) -> FeederStatus:
        return await fetch_status(self._session, self.kind, self._url, self._user_agent)
