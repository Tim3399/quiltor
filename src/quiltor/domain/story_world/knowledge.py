from __future__ import annotations

import math
import re
from dataclasses import dataclass, asdict
from typing import Any


@dataclass(frozen=True)
class KnowledgeChunk:
    id: str
    kind: str
    title: str
    text: str
    target: dict[str, str]

    def public(self) -> dict[str, Any]:
        return asdict(self)


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def moment_order(timeline: list[dict[str, Any]], moment_id: Any) -> int:
    """Mirrors packages/client/src/modules/story-world/figures/presence.ts's momentIndex: -1 for "no moment" (base
    state, sorts first), the timeline position for a real moment, -2 for a dangling
    reference to a moment that no longer exists (sorts before everything, surfacing the
    inconsistency rather than hiding it).
    """
    if not moment_id:
        return -1
    for index, moment in enumerate(timeline):
        if moment.get("id") == moment_id:
            return index
    return -2


def _parts(text: str, limit: int = 1400) -> list[str]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text or "") if part.strip()]
    result: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > limit:
            result.append(current)
            current = ""
        while len(paragraph) > limit:
            result.append(paragraph[:limit])
            paragraph = paragraph[limit:]
        current = f"{current}\n\n{paragraph}".strip()
    if current:
        result.append(current)
    return result


def build_knowledge(manuscript: dict[str, Any], figures: dict[str, Any]) -> list[KnowledgeChunk]:
    chunks: list[KnowledgeChunk] = []
    nodes = figures.get("nodes") or []
    names = {node.get("id"): node.get("name", "Unbekannt") for node in nodes}
    for chapter_index, chapter in enumerate(manuscript.get("chapters") or []):
        title = _clean(chapter.get("title")) or f"Kapitel {chapter_index + 1}"
        for index, part in enumerate(_parts(str(chapter.get("body") or ""))):
            chunks.append(
                KnowledgeChunk(
                    f"chapter:{chapter['id']}:{index}",
                    "chapter",
                    title,
                    part,
                    {"workspace": "text", "id": chapter["id"]},
                )
            )
        note = _clean(chapter.get("note"))
        if note:
            chunks.append(
                KnowledgeChunk(
                    f"chapter-note:{chapter['id']}",
                    "chapter-note",
                    f"Notiz · {title}",
                    note,
                    {"workspace": "text", "id": chapter["id"]},
                )
            )
    for node in nodes:
        profile = node.get("profile") or {}
        profile_lines = [
            f"Art: {node.get('type', 'person')}",
            f"Rolle/Kategorie: {_clean(node.get('label'))}",
            f"Kurzbeschreibung: {_clean(node.get('sub'))}",
            f"Alter: {_clean(profile.get('alter'))}",
            f"Rolle: {_clean(profile.get('rolle'))}",
            f"Aussehen: {_clean(profile.get('aussehen'))}",
            f"Herkunft: {_clean(profile.get('herkunft'))}",
            f"Stimme: {_clean(profile.get('stimme'))}",
            f"Notizen: {_clean(profile.get('notizen'))}",
        ]
        profile_lines.extend(
            f"{_clean(field.get('k'))}: {_clean(field.get('v'))}"
            for field in profile.get("extra") or []
        )
        text = "\n".join(line for line in profile_lines if not line.endswith(": "))
        chunks.append(
            KnowledgeChunk(
                f"element:{node['id']}",
                "element",
                _clean(node.get("name")) or "Ohne Namen",
                text,
                {"workspace": "figures", "id": node["id"]},
            )
        )
    timeline = figures.get("timeline") or []
    moments = {moment.get("id"): moment for moment in timeline}
    for moment in timeline:
        text = "\n".join(
            part
            for part in [f"Datum: {_clean(moment.get('date'))}", _clean(moment.get("note"))]
            if part and not part.endswith(": ")
        )
        chunks.append(
            KnowledgeChunk(
                f"timeline:{moment['id']}",
                "timeline",
                _clean(moment.get("title")) or "Zeitpunkt",
                text,
                {"workspace": "figures", "id": moment["id"]},
            )
        )
    for edge in figures.get("edges") or []:
        direction = "gerichtet" if edge.get("gerichtet") else "ungerichtet"
        lines = [
            f"{names.get(edge.get('from'))} → {names.get(edge.get('to'))}",
            f"Beziehung: {_clean(edge.get('label'))}",
            f"Art: {direction}",
        ]
        for version in edge.get("versions") or []:
            moment = moments.get(version.get("momentId"), {})
            lines.append(
                f"Ab {_clean(moment.get('title')) or version.get('momentId')}: {_clean(version.get('label')) or 'ohne Bezeichnung'} ({'aktiv' if version.get('active') else 'beendet'})"
            )
        chunks.append(
            KnowledgeChunk(
                f"relationship:{edge['id']}",
                "relationship",
                f"{names.get(edge.get('from'))} · {names.get(edge.get('to'))}",
                "\n".join(lines),
                {
                    "workspace": "figures",
                    "id": str(edge.get("from", "")),
                    "from": str(edge.get("from", "")),
                    "to": str(edge.get("to", "")),
                },
            )
        )
    by_element: dict[str, list[dict[str, Any]]] = {}
    for entry in figures.get("presence") or []:
        by_element.setdefault(entry.get("elementId"), []).append(entry)
    for element_id, entries in by_element.items():
        ordered = sorted(entries, key=lambda entry: moment_order(timeline, entry.get("momentId")))
        lines = []
        for entry in ordered:
            place_name = names.get(entry.get("placeId"), "Unbekannter Ort")
            moment = moments.get(entry.get("momentId"))
            when = _clean(moment.get("title")) if moment else "Ausgangslage"
            date = _clean(moment.get("date")) if moment else ""
            lines.append(f"{when}{f' ({date})' if date else ''}: {place_name}")
        chunks.append(
            KnowledgeChunk(
                f"presence:{element_id}",
                "presence",
                f"Aufenthalte · {names.get(element_id, 'Unbekannt')}",
                "\n".join(lines),
                {"workspace": "figures", "id": str(element_id)},
            )
        )
    return chunks


def retrieve(chunks: list[KnowledgeChunk], query: str, limit: int = 14) -> list[KnowledgeChunk]:
    """Local hybrid retrieval: exact phrases, word vectors and structured graph expansion."""
    tokens = set(re.findall(r"[\wÄÖÜäöüß]{2,}", query.casefold()))
    if not tokens:
        return chunks[:limit]
    scored: list[tuple[float, KnowledgeChunk]] = []
    query_folded = query.casefold().strip()
    for chunk in chunks:
        haystack = f"{chunk.title} {chunk.text}".casefold()
        words = re.findall(r"[\wÄÖÜäöüß]{2,}", haystack)
        counts = {token: words.count(token) for token in tokens}
        overlap = sum(1 + math.log(count) for count in counts.values() if count)
        phrase = 5.0 if query_folded and query_folded in haystack else 0.0
        title = sum(2.5 for token in tokens if token in chunk.title.casefold())
        score = overlap + phrase + title
        if score:
            scored.append((score, chunk))
    selected = [
        chunk for _, chunk in sorted(scored, key=lambda item: (-item[0], item[1].id))[:limit]
    ]
    related_ids = {chunk.target.get("id") for chunk in selected if chunk.kind == "element"}
    for chunk in chunks:
        if len(selected) >= limit:
            break
        if (
            chunk.kind == "relationship"
            and related_ids.intersection({chunk.target.get("from"), chunk.target.get("to")})
            and chunk not in selected
        ):
            selected.append(chunk)
    return selected or chunks[: min(limit, len(chunks))]
