from __future__ import annotations


def parse_openthesaurus(lines):
    for raw in lines:
        line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        if not line.strip() or line.startswith("#"):
            continue
        words = [part.split("(", 1)[0].strip() for part in line.strip().split(";")]
        words = list(dict.fromkeys(word for word in words if word))
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
