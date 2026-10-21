"""Texts the integration writes into feeds: detail row labels, sources, sort orders, and how numbers are written.

One JSON file per language in texts/, with English as the reference. To add a
language for feeds, copy texts/en.json to texts/<code>.json, translate the values
(keep the {placeholders}) and set its number separators, add the code to LANGUAGES
in const.py, and add it to selector.language.options in every translations/*.json.
Home Assistant's UI in the same language is translations/<code>.json, a copy of
translations/en.json. The tests check that every file has the same keys and
placeholders as English, and that LANGUAGES, the selector and texts/ agree.

These are not Home Assistant UI translations (those are in translations/):
feeds are plain data, written in the language chosen for the integration.
"""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path

from homeassistant.core import HomeAssistant

TEXTS_DIR = Path(__file__).parent / "texts"
PLACEHOLDER = re.compile(r"\{(\w+)\}")


class Texts:
    """Looks up a text and fills in placeholders: texts("climbing", rate="5.2 m/s") → "climbing 5.2 m/s"."""

    def __init__(self, texts: dict[str, str]) -> None:
        # Every language has every key, as the tests check, so a missing one is a bug and fails loudly.
        self._texts = texts
        self._separators = str.maketrans({",": self("thousands_separator"), ".": self("decimal_separator")})

    def __call__(self, key: str, **values: object) -> str:
        return PLACEHOLDER.sub(lambda match: str(values.get(match.group(1), "")), self._texts[key])

    def number(self, value: float, decimals: int = 0) -> str:
        """ "33 000" and "2,5" in Finnish, "33,000" and "2.5" in English. Negative decimals round to tens, hundreds…"""
        # Rounded first, and + 0.0 turns the -0.0 of a small negative number into 0.
        return f"{round(value, decimals) + 0.0:,.{max(decimals, 0)}f}".translate(self._separators)


@cache
def read_texts_file(language: str) -> dict[str, str]:
    """A language's texts. Every language in LANGUAGES has a file, so a missing one is an error."""
    with (TEXTS_DIR / f"{language}.json").open(encoding="utf-8") as file:
        return json.load(file)


def load_texts(language: str) -> Texts:
    """Reads the file; blocking, so call it from an executor (see async_load_texts)."""
    return Texts(read_texts_file(language))


async def async_load_texts(hass: HomeAssistant, language: str) -> Texts:
    return await hass.async_add_executor_job(load_texts, language)
