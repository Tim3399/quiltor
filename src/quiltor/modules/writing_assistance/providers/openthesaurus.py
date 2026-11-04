from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from typing import Any

# Usage labels such as "(ugs.)" or a reflexive "(sich)" may stand anywhere in a
# term; the word itself is what remains around them.
_LABEL = re.compile(r"\([^)]*\)")


def _term(part: str) -> str:
    return " ".join(_LABEL.sub(" ", part).split())


def parse_openthesaurus(lines: Iterable[str | bytes]) -> Iterator[dict[str, Any]]:
    for raw in lines:
        line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        if not line.strip() or line.startswith("#"):
            continue
        words = list(
            dict.fromkeys(word for part in line.strip().split(";") if (word := _term(part)))
        )
        for word in words:
            yield {
                "language": "de-DE",
                "mode": "synonyms",
                "query": word,
                "lemma": word,
                "part_of_speech": "",
                "meaning": "",
                "values": [item for item in words if item != word],
                "source": "openthesaurus",
            }
