"""HTTP clients for a local readsb receiver and for adsb.fi.

readsb's JSON is documented in https://github.com/wiedehopf/readsb/blob/dev/README-json.md,
and tar1090 serves it under data/. adsb.fi's open data API (https://github.com/adsbfi/opendata)
answers in the same format.
"""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp
from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN
from .geo import KM_PER_NM

ADSB_FI_API = "https://opendata.adsb.fi/api/v3"
# The largest radius adsb.fi's position query accepts.
ADSB_FI_MAX_RADIUS_NM = 250
# The query's centre is rounded, so the query reaches this much farther than the feed's area.
ADSB_FI_MARGIN_NM = 1
# The largest area a feed with adsb.fi can have, so the margin still fits within adsb.fi's limit.
ADSB_FI_MAX_AREA_KM = (ADSB_FI_MAX_RADIUS_NM - ADSB_FI_MARGIN_NM) * KM_PER_NM
# adsb.fi allows one request a second from an address, failed ones included.
ADSB_FI_SPACING_SECONDS = 1.1

REQUEST_TIMEOUT_SECONDS = 15
# adsb.fi answers in well under a second. A request that hangs holds every other feed's turn, so it gives up sooner.
ADSB_FI_TIMEOUT_SECONDS = 5


class AdsbError(Exception):
    """A request to the receiver or to adsb.fi failed."""


def normalize_url(url: str) -> str:
    """The receiver's address without a trailing slash or data/: what the files under data/ are relative to.

    The scheme and host are in lower case, as they don't depend on it. With the login left out (without_login),
    this is the receiver's id, so the same address can't be added twice.
    A login before the host keeps its case. A query or fragment, as in an address copied from tar1090 with an
    aircraft selected, is left out.
    """
    parts = urlsplit(url.strip())
    login, at, host = parts.netloc.rpartition("@")
    url = urlunsplit((parts.scheme.lower(), f"{login}{at}{host.lower()}", parts.path, "", ""))
    return url.rstrip("/").removesuffix("/data")


def without_login(url: str) -> str:
    """The address as it may be shown, in the log or as a link: without a username or password in it."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc.rpartition("@")[2], parts.path, parts.query, parts.fragment))


async def _get_json(
    session: aiohttp.ClientSession,
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = REQUEST_TIMEOUT_SECONDS,
    name: str | None = None,
) -> dict[str, Any]:
    """The JSON object at `url`. Errors name the source by `name` when given, and by the URL otherwise."""
    source = name or url
    try:
        async with asyncio.timeout(timeout):
            async with session.get(url, headers=headers) as response:
                if response.status != 200:
                    raise AdsbError(f"HTTP {response.status} from {source}")
                data = await response.json(content_type=None)
    except (aiohttp.ClientError, TimeoutError, ValueError) as err:
        if name:
            # A named source's error gives only its type, and leaves the cause out of the chain, since aiohttp
            # writes the URL into some of its messages, and a debug log prints the cause with its traceback.
            raise AdsbError(f"Request to {source} failed: {type(err).__name__}") from None
        raise AdsbError(f"Request to {source} failed: {err!r}") from err
    if not isinstance(data, dict):
        raise AdsbError(f"Unexpected answer from {source}")
    return data


class ReceiverClient:
    """The receiver's files under data/."""

    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def receiver(self, url: str) -> dict[str, Any]:
        """The receiver's settings: its position and readsb's version."""
        return await self._get(f"{url}/data/receiver.json")

    async def aircraft(self, url: str) -> dict[str, Any]:
        """Every aircraft the receiver is tracking."""
        return await self._get(f"{url}/data/aircraft.json")

    async def stats(self, url: str) -> dict[str, Any]:
        """The receiver's statistics, for the last minute, 5 and 15 minutes and since it started."""
        return await self._get(f"{url}/data/stats.json")

    async def _get(self, url: str) -> dict[str, Any]:
        # An address with a login is named without it, and with only the error's type, which aiohttp may
        # otherwise write the whole address into.
        shown = without_login(url)
        return await _get_json(self._session, url, name=shown if shown != url else None)


class RequestSpacing:
    """Keeps requests at least `seconds` apart, from the end of one to the start of the next, however many callers share it."""

    def __init__(self, seconds: float) -> None:
        self._seconds = seconds
        self._lock = asyncio.Lock()
        self._last: float | None = None

    async def __aenter__(self) -> None:
        await self._lock.acquire()
        try:
            if self._last is not None and (delay := self._last + self._seconds - time.monotonic()) > 0:
                await asyncio.sleep(delay)
        except BaseException:
            self._lock.release()
            raise

    async def __aexit__(self, *exc_info: object) -> None:
        self._last = time.monotonic()
        self._lock.release()


class AdsbFiClient:
    """adsb.fi's position query, one for the whole of Home Assistant.

    Every feed of every receiver shares it, so they share adsb.fi's limit: requests
    carry the integration's own User-Agent and wait their turn.
    """

    def __init__(self, session: aiohttp.ClientSession, user_agent: str) -> None:
        self._session = session
        self._user_agent = user_agent
        self._spacing = RequestSpacing(ADSB_FI_SPACING_SECONDS)

    async def aircraft_near(self, latitude: float, longitude: float, radius_km: float) -> dict[str, Any]:
        """Aircraft adsb.fi knows within a radius, and a little beyond it.

        The centre is rounded to about a kilometre, so the query doesn't give away
        where the area's centre is, often someone's home. The margin makes up for
        it, and the feed keeps only what is inside its area. adsb.fi takes the
        radius in whole nautical miles.
        """
        radius_nm = min(ADSB_FI_MAX_RADIUS_NM, math.ceil(radius_km / KM_PER_NM) + ADSB_FI_MARGIN_NM)
        url = f"{ADSB_FI_API}/lat/{latitude:.2f}/lon/{longitude:.2f}/dist/{radius_nm}"
        async with self._spacing:
            # Named without the URL, so a log pasted into an issue doesn't show where the area is.
            return await _get_json(self._session, url, {"User-Agent": self._user_agent}, ADSB_FI_TIMEOUT_SECONDS, "adsb.fi")


ADSB_FI_CLIENT: HassKey[AdsbFiClient] = HassKey(f"{DOMAIN}_adsb_fi")
