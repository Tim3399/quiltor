from __future__ import annotations

import xml.etree.ElementTree as ET

def _text(element): return " ".join("".join(element.itertext()).split())

def parse_freedict(source, source_language: str, target_language: str):
    root = ET.parse(source).getroot()
    for entry in root.findall(".//{*}entry"):
        heads = [_text(item) for item in entry.findall(".//{*}orth") if _text(item)]
        translations = [_text(item) for item in entry.findall(".//{*}quote") if _text(item)]
        if not translations: translations = [_text(item) for item in entry.findall(".//{*}tr") if _text(item)]
        pos = next((_text(item) for item in entry.findall(".//{*}pos") if _text(item)), "")
        for head in heads:
            if translations:
                yield {"language": source_language, "mode": "translation", "query": head, "lemma": head, "part_of_speech": pos, "meaning": "", "values": list(dict.fromkeys(translations)), "source": f"freedict-{source_language}-{target_language}"}
