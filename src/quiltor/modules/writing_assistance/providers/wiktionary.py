from __future__ import annotations

import json


def parse_wiktionary(lines):
    for raw in lines:
        value = json.loads(raw)
        if value.get("lang_code") not in ("de", "deu"):
            continue
        word, pos = str(value.get("word", "")).strip(), str(value.get("pos", ""))
        for sense in value.get("senses") or []:
            glosses = [
                str(item).strip() for item in sense.get("glosses") or [] if str(item).strip()
            ]
            if word and glosses:
                yield {
                    "language": "de-DE",
                    "mode": "dictionary",
                    "query": word,
                    "lemma": word,
                    "part_of_speech": pos,
                    "meaning": "; ".join(glosses),
                    "values": [],
                    "source": "wiktionary",
                }
