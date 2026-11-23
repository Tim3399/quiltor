"""The world state for one part of an extraction in a large world (T-344).

When the whole world does not fit beside the manuscript, a part no longer gets every entry
(T-330 refused then). It gets, in this order of the budget:

1. a register of every element by name, grouped by type -- fixed, so the model can see that
   a figure exists even when it is not written out (D-244, F-344-9);
2. the elements the text of the part mentions, in their shortest form;
3. the time window of the chapter: its storyTime span and five moments either side;
4. relationships between mentioned elements, presence of mentioned elements in the window,
   the full fields of the mentioned elements, relationships with one mentioned end.

Whatever does not fit is counted under ``omitted``. Nothing is refused: duplicates are
stopped by the resolver, which reads the whole world, not by the prompt (T-344 plan, §0).
Names are matched deterministically; for figures (person, animal) the parts of a name count
too, so "Oda" and "Frau Brandt" find "Oda Brandt" (D-243, F-344-7).
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from quiltor.modules.assistant.contract import FittedWorld, structured_world_state

#: Types whose names are matched by their parts as well (D-244, F-344-7).
NAME_PART_TYPES = frozenset({"person", "tier"})
#: Words of a name that never stand for it on their own. German, because they read German text.
NAME_PART_STOPWORDS = frozenset(
    {
        "der",
        "die",
        "das",
        "den",
        "dem",
        "des",
        "von",
        "vom",
        "zu",
        "zum",
        "zur",
        "am",
        "im",
        "an",
        "auf",
        "und",
        "van",
        "de",
        "la",
        "le",
    }
)
#: Forms of address before a name part ("Frau Brandt", "Kapitänin Estrand"). German, like the
#: manuscripts they read; a first or last name alone works in any language.
HONORIFICS = (
    "frau",
    "herr",
    "fräulein",
    "kapitän",
    "kapitänin",
    "meister",
    "meisterin",
    "doktor",
    "dr.",
    "mutter",
    "vater",
)
#: Moments either side of the chapter's storyTime span (D-244, F-344-8).
WINDOW = 5
#: Share of the world budget the register may take before it is cut by relevance.
REGISTER_SHARE = 0.7

SELECTED_WORLD_HEADER = (
    "STRUCTURED WORLD STATE (selected for this part of the manuscript: the entries the text "
    "mentions are written out, every other element is listed by name only in `register`, "
    "and `omitted` counts what is not shown. Use resolve_entity, get_entity or "
    "find_timeline_events for anything not written out. An element listed in `register` "
    "exists: do not propose it again)"
)


class SelectedWorld(FittedWorld):
    """A world state chosen for one part; it always says that it is a selection."""

    @property
    def header(self) -> str:
        return SELECTED_WORLD_HEADER


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def name_parts(name: str) -> list[str]:
    """The words of a figure's name that may stand for it alone: three letters or more and
    not a function word ("Oda", "Brandt" for "Oda Brandt")."""
    words = re.findall(r"[^\W\d_][\w'\u2019-]*", name)
    return [word for word in words if len(word) >= 3 and word.casefold() not in NAME_PART_STOPWORDS]


def _aliases(node: Mapping[str, Any]) -> list[str]:
    return [
        str(item["alias"]).strip()
        for item in node.get("aliases") or []
        if isinstance(item, Mapping)
        and isinstance(item.get("alias"), str)
        and item["alias"].strip()
    ]


def element_surfaces(node: Mapping[str, Any]) -> list[str]:
    """What the text may call an element: its name and aliases, and for a figure the parts
    of those."""
    full = [value for value in (str(node.get("name") or "").strip(), *_aliases(node)) if value]
    surfaces = list(full)
    if str(node.get("type") or "person") in NAME_PART_TYPES:
        for value in full:
            surfaces.extend(name_parts(value))
    return list(dict.fromkeys(surfaces))


def mentioned_elements(text: str, nodes: Sequence[Mapping[str, Any]]) -> list[str]:
    """The ids of the elements ``text`` mentions, most often first, then by first mention.

    A surface shared by several elements ("Brandt" for two of a family) names all of them:
    which one is meant is the resolver's question, not the selection's."""
    owners: dict[str, set[str]] = {}
    for node in nodes:
        ident = node.get("id")
        if not isinstance(ident, str):
            continue
        for surface in element_surfaces(node):
            owners.setdefault(surface.casefold(), set()).add(ident)
    if not owners or not text:
        return []
    # Longest first, so "Oda Brandt" wins over "Oda" at the same place; a genitive s or an
    # apostrophe may follow a name.
    alternatives = sorted(owners, key=len, reverse=True)
    pattern = re.compile(
        r"(?<!\w)("
        + "|".join(re.escape(item) for item in alternatives)
        + r")(?:s|'|\u2019)?(?!\w)",
        re.IGNORECASE,
    )
    counts: dict[str, int] = {}
    first: dict[str, int] = {}
    for match in pattern.finditer(text):
        for ident in owners.get(match.group(1).casefold(), ()):
            counts[ident] = counts.get(ident, 0) + 1
            first.setdefault(ident, match.start())
    return sorted(counts, key=lambda ident: (-counts[ident], first[ident]))


def _moment_order(moments: Sequence[Mapping[str, Any]]) -> list[str]:
    """Moments in story order: by day number (``time``), by position where it is missing."""

    def key(item: tuple[int, Mapping[str, Any]]) -> tuple[float, float, int]:
        index, moment = item
        time = moment.get("time")
        position = moment.get("position")
        day = (
            float(time)
            if isinstance(time, int | float) and not isinstance(time, bool)
            else math.inf
        )
        place = float(position) if isinstance(position, int | float) else float(index)
        return (day, place, index)

    return [
        str(moment.get("id"))
        for _, moment in sorted(enumerate(moments), key=key)
        if moment.get("id")
    ]


def chapter_anchor(
    manuscript: Mapping[str, Any], chapter_ids: Sequence[str]
) -> tuple[str, str] | None:
    """The storyTime span of the first chosen chapter, or of the nearest chapter before it
    that has one (D-244, F-344-8); None when no chapter up to it has one."""
    chapters = [item for item in manuscript.get("chapters") or [] if isinstance(item, Mapping)]
    chosen = set(chapter_ids)
    index = next(
        (number for number, chapter in enumerate(chapters) if chapter.get("id") in chosen), None
    )
    if index is None:
        return None
    for chapter in reversed(chapters[: index + 1]):
        span = chapter.get("storyTime")
        if isinstance(span, Mapping) and isinstance(span.get("startMomentId"), str):
            start = str(span["startMomentId"])
            end = span.get("endMomentId")
            return start, end if isinstance(end, str) else start
    return None


def moment_window(
    figures: Mapping[str, Any], manuscript: Mapping[str, Any], chapter_ids: Sequence[str]
) -> list[str]:
    """The ids of the chapter's span and WINDOW moments either side, in story order."""
    order = _moment_order(
        [item for item in figures.get("timeline") or [] if isinstance(item, Mapping)]
    )
    anchor = chapter_anchor(manuscript, chapter_ids)
    if anchor is None or anchor[0] not in order:
        return []
    start = order.index(anchor[0])
    end = order.index(anchor[1]) if anchor[1] in order else start
    low, high = min(start, end), max(start, end)
    return order[max(0, low - WINDOW) : high + WINDOW + 1]


def _register(nodes: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    """Every element by name, one string per type, "; " between them: a list of quoted
    strings costs a tenth more, and a name may hold a comma."""
    register: dict[str, list[str]] = {}
    for node in nodes:
        name = str(node.get("name") or node.get("id") or "").strip()
        if not name:
            continue
        aliases = _aliases(node)
        entry = f"{name} ({', '.join(aliases)})" if aliases else name
        register.setdefault(str(node.get("type") or "person"), []).append(entry)
    return {kind: "; ".join(names) for kind, names in register.items()}


def _neighbour_mentions(
    manuscript: Mapping[str, Any], chapter_ids: Sequence[str], nodes: Sequence[Mapping[str, Any]]
) -> list[str]:
    """Element ids by how close to the chosen chapters they are mentioned: the chapters
    themselves, then one chapter either side, two, and so on (D-244, F-344-9)."""
    chapters = [item for item in manuscript.get("chapters") or [] if isinstance(item, Mapping)]
    chosen = [
        number for number, chapter in enumerate(chapters) if chapter.get("id") in set(chapter_ids)
    ]
    if not chosen:
        return []
    ranked: list[str] = []
    for distance in range(len(chapters)):
        near = {
            number
            for origin in chosen
            for number in (origin - distance, origin + distance)
            if 0 <= number < len(chapters)
        }
        text = "\n".join(str(chapters[number].get("body") or "") for number in sorted(near))
        for ident in mentioned_elements(text, nodes):
            if ident not in ranked:
                ranked.append(ident)
        if len(near) == len(chapters):
            break
    return ranked


def select_world_state(
    figures: dict[str, Any],
    contract: dict[str, Any],
    *,
    text: str,
    manuscript: Mapping[str, Any],
    chapter_ids: Sequence[str],
    target: int,
    count: Callable[[str], int],
) -> SelectedWorld:
    """The world state for one part of an extraction, in at most ``target`` tokens.

    ``text`` is the manuscript this part carries; what it mentions is written out."""
    full = structured_world_state(figures, contract)
    nodes = [item for item in figures.get("nodes") or [] if isinstance(item, Mapping)]
    by_id = {str(node.get("id")): node for node in nodes}
    elements = {str(item.get("id")): item for item in full.get("elements") or []}
    relevant = [ident for ident in mentioned_elements(text, nodes) if ident in elements]
    omitted: dict[str, int] = {}
    state: dict[str, Any] = {"selected": True}

    def cost(value: Any) -> int:
        return count(_dump(value))

    # 1. The register, cut by relevance only when it alone would take too much.
    register_nodes = list(nodes)
    register = _register(register_nodes)
    if cost(register) > REGISTER_SHARE * target:
        order = relevant + [
            ident
            for ident in _neighbour_mentions(manuscript, chapter_ids, nodes)
            if ident not in relevant
        ]
        order += [str(node.get("id")) for node in nodes if str(node.get("id")) not in order]
        kept: list[Mapping[str, Any]] = []
        for ident in order:
            trial = _register([*kept, by_id[ident]]) if ident in by_id else None
            if trial is None:
                continue
            if cost(trial) > REGISTER_SHARE * target:
                break
            kept.append(by_id[ident])
        # Keep the world's own order within the register.
        kept_ids = {str(node.get("id")) for node in kept}
        register_nodes = [node for node in nodes if str(node.get("id")) in kept_ids]
        register = _register(register_nodes)
        omitted["register"] = len(nodes) - len(register_nodes)
    state["register"] = register

    # Room kept for the omitted counts, which are only known at the end.
    room = target - cost({"omitted": {scope: 9999 for scope in [*full, "register"]}})

    def fits(candidate: dict[str, Any]) -> bool:
        return cost(candidate) <= room

    # 2. The mentioned elements, shortest form first.
    shortest = [
        {key: elements[ident][key] for key in ("id", "type", "name") if key in elements[ident]}
        for ident in relevant
    ]
    shown: list[dict[str, Any]] = []
    for entry in shortest:
        trial = {**state, "elements": [*shown, entry]}
        if not fits(trial):
            break
        shown.append(entry)
    state["elements"] = shown
    # 3. The time window: span and neighbours, shortest form (what set_presence needs).
    if "timeline" in full:
        window = set(moment_window(figures, manuscript, chapter_ids))
        moments = [
            {key: item[key] for key in ("id", "title", "date") if key in item}
            for item in full["timeline"]
            if item.get("id") in window
        ]
        trial = {**state, "timeline": moments}
        while moments and not fits(trial):
            moments.pop()
            trial = {**state, "timeline": moments}
        state["timeline"] = moments
        omitted["timeline"] = len(full["timeline"]) - len(moments)

    shown_ids = {str(item.get("id")) for item in shown}
    window_ids = {str(item.get("id")) for item in state.get("timeline") or []}

    # 4. Relationships between mentioned elements, presence in the window, full fields,
    #    relationships with one mentioned end.
    relationships = full.get("relationships") or []
    both = [
        item
        for item in relationships
        if item.get("from") in shown_ids and item.get("to") in shown_ids
    ]
    one = [
        item
        for item in relationships
        if (item.get("from") in shown_ids) != (item.get("to") in shown_ids)
    ]
    presence = [
        item
        for item in full.get("presence") or []
        if item.get("elementId") in shown_ids
        and (item.get("momentId") in window_ids or not item.get("momentId"))
    ]

    def add_all(scope: str, entries: list[dict[str, Any]]) -> None:
        for entry in entries:
            trial = {**state, scope: [*state.get(scope, []), entry]}
            if fits(trial):
                state[scope] = trial[scope]

    if "relationships" in full:
        state["relationships"] = []
        add_all("relationships", both)
    if "presence" in full:
        state["presence"] = []
        add_all("presence", presence)
    for position, entry in enumerate(list(state["elements"])):
        fuller = dict(elements[str(entry.get("id"))])
        trial_elements = list(state["elements"])
        trial_elements[position] = fuller
        if fits({**state, "elements": trial_elements}):
            state["elements"] = trial_elements
    if "relationships" in full:
        add_all("relationships", one)
        omitted["relationships"] = len(relationships) - len(state["relationships"])
    if "presence" in full:
        omitted["presence"] = len(full.get("presence") or []) - len(state["presence"])
    omitted["elements"] = len(elements) - len(state["elements"])
    state["omitted"] = {scope: number for scope, number in omitted.items() if number}
    return SelectedWorld(state, cost(state), True)


__all__ = [
    "HONORIFICS",
    "NAME_PART_TYPES",
    "SELECTED_WORLD_HEADER",
    "SelectedWorld",
    "chapter_anchor",
    "element_surfaces",
    "mentioned_elements",
    "moment_window",
    "name_parts",
    "select_world_state",
]
