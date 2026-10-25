"""The receiver card that comes with the integration: served, and kept in the dashboards' resources."""

import logging

import aiohttp
import pytest
from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.adsb_live.const import DOMAIN

from .conftest import RECEIVER, RECEIVER_URL, local_aircraft, receiver_entry, stats

pytestmark = pytest.mark.asyncio

CARD = "/adsb_live/adsb-receiver-card.js"
OLD = f"{CARD}?v=1.2.0"
OLDER = f"{CARD}?v=1.1.0"
SEPARATE = "/hacsfiles/adsb-receiver-card/adsb-receiver-card.js?hacstag=123456789"
OTHER = "/hacsfiles/some-card/some-card.js"
# Stands for the card's resource at the integration's current version.
CURRENT = "current"
SECOND_URL = "http://second.example:8080"


async def _url(hass: HomeAssistant, url: str) -> str:
    return f"{CARD}?v={(await async_get_integration(hass, DOMAIN)).version}" if url == CURRENT else url


def _store(hass_storage, urls: list[str]) -> None:
    """Resources as Home Assistant keeps them between starts, not yet loaded when the integration starts."""
    items = [{"id": f"resource{index}", "type": "module", "url": url} for index, url in enumerate(urls)]
    hass_storage["lovelace_resources"] = {"version": 1, "minor_version": 1, "key": "lovelace_resources", "data": {"items": items}}


def _answering(aioclient_mock: AiohttpClientMocker, url: str) -> None:
    aioclient_mock.get(f"{url}/data/receiver.json", json=RECEIVER)
    aioclient_mock.get(f"{url}/data/aircraft.json", json=local_aircraft())
    aioclient_mock.get(f"{url}/data/stats.json", json=stats())


async def _setup(
    hass: HomeAssistant,
    hass_storage,
    aioclient_mock: AiohttpClientMocker,
    resources: list[str],
    yaml: bool = False,
    disabled: bool = False,
    receivers: int = 1,
) -> list[MockConfigEntry]:
    """The integration with receivers that answer and have no feeds, started with the given resources."""
    urls = [await _url(hass, url) for url in resources]
    if yaml:
        config = {"resource_mode": "yaml", "resources": [{"url": url, "type": "module"} for url in urls]}
        assert await async_setup_component(hass, "lovelace", {"lovelace": config})
    else:
        _store(hass_storage, urls)
        assert await async_setup_component(hass, "lovelace", {})
    entries = []
    for url in [RECEIVER_URL, SECOND_URL][:receivers]:
        _answering(aioclient_mock, url)
        entries.append(receiver_entry(hass, feeds=0, url=url, disabled=disabled))
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    return entries


async def _urls(hass: HomeAssistant) -> list[str]:
    resources = hass.data[LOVELACE_DATA].resources
    await resources.async_get_info()
    return [item["url"] for item in resources.async_items()]


def _warnings(caplog) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.name.endswith(".card") and record.levelno == logging.WARNING]


@pytest.mark.parametrize(
    ("before", "after"),
    [
        # One resource of the card's own, at the current version, is kept in place of any others of its own.
        ([], [CURRENT]),
        ([OTHER], [OTHER, CURRENT]),
        ([CURRENT], [CURRENT]),
        ([OLD], [CURRENT]),
        ([CARD], [CURRENT]),
        ([OLD, CURRENT], [CURRENT]),
        ([CURRENT, OLD], [CURRENT]),
        ([OLDER, OLD], [CURRENT]),
        ([CURRENT, CURRENT], [CURRENT]),
        ([OTHER, OLD, OTHER], [OTHER, CURRENT, OTHER]),
        # The current one is the one kept, and nothing else moves.
        ([OLD, OTHER, CURRENT], [OTHER, CURRENT]),
        # The card installed on its own is left as it is.
        ([SEPARATE], [SEPARATE, CURRENT]),
        ([SEPARATE, OLD], [SEPARATE, CURRENT]),
    ],
)
async def test_storage_mode_keeps_one_resource_at_the_current_version(
    hass: HomeAssistant, hass_storage, aioclient_mock, caplog, before, after
):
    await _setup(hass, hass_storage, aioclient_mock, before)
    assert await _urls(hass) == [await _url(hass, url) for url in after]
    # A resource already current is kept as it is, not replaced by another updated to it.
    if CURRENT in before:
        ids = [item["id"] for item in hass.data[LOVELACE_DATA].resources.async_items() if item["url"] == await _url(hass, CURRENT)]
        assert ids == [f"resource{before.index(CURRENT)}"]
    # Only the card installed on its own is warned about, by its resource.
    warnings = _warnings(caplog)
    assert len(warnings) == (1 if SEPARATE in before else 0)
    assert all(SEPARATE in warning for warning in warnings)


async def test_two_receivers_starting_together_add_one_resource(hass: HomeAssistant, hass_storage, aioclient_mock):
    # Their setups run side by side, and both find no resource of the card's when they start.
    await _setup(hass, hass_storage, aioclient_mock, [], receivers=2)
    assert await _urls(hass) == [await _url(hass, CURRENT)]


@pytest.mark.parametrize(
    ("resources", "asked"),
    [
        ([], "add"),
        ([OTHER], "add"),
        ([OLD], "change"),
        ([CARD], "change"),
        ([CURRENT], None),
        ([OLD, CURRENT], None),
        ([CURRENT, OLD], None),
        # Of several earlier ones, the first is the one to change.
        ([OLDER, OLD], "change"),
    ],
)
async def test_yaml_mode_is_left_alone_and_asks_for_the_current_line(
    hass: HomeAssistant, hass_storage, aioclient_mock, caplog, resources, asked
):
    await _setup(hass, hass_storage, aioclient_mock, resources, yaml=True)
    current = await _url(hass, CURRENT)
    assert await _urls(hass) == [await _url(hass, url) for url in resources]
    warnings = _warnings(caplog)
    if asked is None:
        assert warnings == []
    elif asked == "add":
        assert len(warnings) == 1
        assert f"Add url: {current}, type: module to them" in warnings[0]
    else:
        assert len(warnings) == 1
        assert f"Change {resources[0]} in them to {current}" in warnings[0]


@pytest.mark.parametrize(("resources", "count"), [([SEPARATE, CURRENT], 1), ([SEPARATE], 2)])
async def test_yaml_mode_warns_about_the_card_installed_on_its_own(
    hass: HomeAssistant, hass_storage, aioclient_mock, caplog, resources, count
):
    await _setup(hass, hass_storage, aioclient_mock, resources, yaml=True)
    warnings = _warnings(caplog)
    assert len(warnings) == count
    assert SEPARATE in warnings[0]
    if count == 2:
        assert f"Add url: {await _url(hass, CURRENT)}, type: module to them" in warnings[1]


async def test_removing_the_integration_in_yaml_mode_asks_to_remove_its_lines(hass: HomeAssistant, hass_storage, aioclient_mock, caplog):
    [entry] = await _setup(hass, hass_storage, aioclient_mock, [OTHER, OLD, SEPARATE, CURRENT], yaml=True)
    caplog.clear()
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert await _urls(hass) == [OTHER, OLD, SEPARATE, await _url(hass, CURRENT)]
    warnings = _warnings(caplog)
    assert len(warnings) == 2
    assert f"Remove {OLD} from them" in warnings[0]
    assert f"Remove {await _url(hass, CURRENT)} from them" in warnings[1]


@pytest.mark.parametrize(
    ("receivers", "removed", "kept"),
    [
        # The card's resources go with the last receiver, and stay while any receiver is left.
        (1, [0], False),
        (2, [0], True),
        (2, [1], True),
        (2, [0, 1], False),
        (2, [1, 0], False),
    ],
)
@pytest.mark.parametrize("disabled", [False, True], ids=["set up", "disabled since the start"])
async def test_removing_the_last_receiver_removes_its_resources_only(
    hass: HomeAssistant, hass_storage, aioclient_mock, receivers, removed, kept, disabled
):
    entries = await _setup(hass, hass_storage, aioclient_mock, [OTHER, OLD, SEPARATE, CURRENT], disabled=disabled, receivers=receivers)
    before = await _urls(hass)
    for index in removed:
        await hass.config_entries.async_remove(entries[index].entry_id)
        await hass.async_block_till_done()
    assert await _urls(hass) == (before if kept else [OTHER, SEPARATE])


async def test_removing_a_receiver_in_yaml_mode_asks_nothing_while_another_is_left(
    hass: HomeAssistant, hass_storage, aioclient_mock, caplog
):
    entries = await _setup(hass, hass_storage, aioclient_mock, [CURRENT], yaml=True, receivers=2)
    caplog.clear()
    await hass.config_entries.async_remove(entries[0].entry_id)
    await hass.async_block_till_done()
    assert _warnings(caplog) == []


async def test_a_receiver_that_does_not_answer_still_gets_the_card(hass: HomeAssistant, hass_storage, aioclient_mock):
    _store(hass_storage, [])
    assert await async_setup_component(hass, "lovelace", {})
    aioclient_mock.get(f"{RECEIVER_URL}/data/receiver.json", exc=aiohttp.ClientError)
    entry = receiver_entry(hass, feeds=0)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_RETRY
    assert await _urls(hass) == [await _url(hass, CURRENT)]


async def test_the_card_is_served(hass: HomeAssistant, hass_storage, aioclient_mock, hass_client):
    await _setup(hass, hass_storage, aioclient_mock, [])
    response = await (await hass_client()).get(await _url(hass, CURRENT))
    assert response.status == 200
    assert "adsb-receiver-card" in await response.text()
