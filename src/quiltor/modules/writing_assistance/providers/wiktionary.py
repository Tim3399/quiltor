from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any

# Limits for the shipped dictionary: the raw extract is ~3 GB, almost all of it
# examples, etymology and inflection tables that a lookup never shows.
MAX_GLOSSES = 8
MAX_MEANING = 500
# Only these parts of speech carry inflected forms worth resolving to a lemma.
FORM_POS = frozenset({"noun", "verb", "adj"})
# Wiktextract marks the header cells of an inflection table with these tags.
_TABLE_TAGS = frozenset({"table-tags", "inflection-template", "class"})


def _record_word(value: dict[str, Any]) -> str | None:
    if value.get("lang_code") not in ("de", "deu"):
        return None
    word = str(value.get("word", "")).strip()
    return word or None


def _entries(value: dict[str, Any], word: str) -> Iterator[dict[str, Any]]:
    pos = str(value.get("pos", ""))
    for sense in (value.get("senses") or [])[:MAX_GLOSSES]:
        glosses = [str(item).strip() for item in sense.get("glosses") or [] if str(item).strip()]
        if glosses:
            yield {
                "language": "de-DE",
                "mode": "dictionary",
                "query": word,
                "lemma": word,
                "part_of_speech": pos,
                "meaning": "; ".join(glosses)[:MAX_MEANING],
                "values": [],
                "source": "wiktionary",
            }
    translations = list(
        dict.fromkeys(
            str(item.get("word", "")).strip()
            for item in _translations(value)
            if item.get("lang_code") == "en" and str(item.get("word", "")).strip()
        )
    )
    if translations:
        yield {
            "language": "de-DE",
            "mode": "translation",
            "query": word,
            "lemma": word,
            "part_of_speech": pos,
            "meaning": "",
            "values": translations,
            "source": "wiktionary",
        }


def _translations(value: dict[str, Any]) -> Iterator[dict[str, Any]]:
    # The German extractor puts translations on the entry; older dumps had them per sense.
    yield from value.get("translations") or []
    for sense in value.get("senses") or []:
        yield from sense.get("translations") or []


def wiktionary_forms(value: dict[str, Any]) -> list[str]:
    """Single-word inflected forms of a German noun, verb or adjective, without
    the lemma itself and without inflection-table header cells."""
    word = _record_word(value)
    if word is None or value.get("pos") not in FORM_POS:
        return []
    forms: list[str] = []
    for item in value.get("forms") or []:
        form = str(item.get("form", "")).strip()
        if (
            form
            and " " not in form
            and form.casefold() != word.casefold()
            and not _TABLE_TAGS & set(item.get("tags") or [])
        ):
            forms.append(form)
    return list(dict.fromkeys(forms))


def parse_wiktionary_records(
    lines: Iterable[str | bytes],
) -> Iterator[tuple[str, list[dict[str, Any]], list[str]]]:
    """One (lemma, entries, forms) triple per German record, read in a single pass."""
    for raw in lines:
        value = json.loads(raw)
        word = _record_word(value)
        if word is None:
            continue
        yield word, list(_entries(value, word)), wiktionary_forms(value)


def parse_wiktionary(lines: Iterable[str | bytes]) -> Iterator[dict[str, Any]]:
    for _word, entries, _forms in parse_wiktionary_records(lines):
        yield from entries
