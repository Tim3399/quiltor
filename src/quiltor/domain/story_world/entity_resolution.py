"""Conservative, deterministic identity resolution for world entities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Sequence


ResolutionStatus = Literal["resolved", "ambiguous", "not_found"]
ENTITY_ALIAS_NORMALIZATION_V1 = "quiltor.story-world.alias-ascii-v1"
ENTITY_ALIAS_ASCII_UPPERCASE_V1 = (65, 90, 32)
ENTITY_ALIAS_SEPARATOR_RANGES_V1 = (
    (0, 47),
    (58, 64),
    (91, 94),
    (96, 96),
    (123, 127),
)


@dataclass(frozen=True)
class ResolutionCandidate:
    element_id: str
    score: float
    reasons: list[str]


@dataclass(frozen=True)
class ResolutionResult:
    status: ResolutionStatus
    mention: str
    resolved_id: str | None
    candidates: list[ResolutionCandidate]


def normalize_entity_name(value: Any) -> str:
    """Frozen v1 identity: ASCII case/separators; non-ASCII code points stay opaque."""

    if not isinstance(value, str):
        return ""
    tokens: list[str] = []
    token: list[str] = []
    uppercase_minimum, uppercase_maximum, lowercase_offset = ENTITY_ALIAS_ASCII_UPPERCASE_V1
    for character in value:
        code_point = ord(character)
        if any(
            minimum <= code_point <= maximum
            for minimum, maximum in ENTITY_ALIAS_SEPARATOR_RANGES_V1
        ):
            if not token:
                continue
            tokens.append("".join(token))
            token = []
            continue
        token.append(
            chr(code_point + lowercase_offset)
            if uppercase_minimum <= code_point <= uppercase_maximum
            else character
        )
    if token:
        tokens.append("".join(token))
    return " ".join(tokens)


def edit_budget(length: int) -> int:
    return min(2, length // 5)


def name_distance(left: str, right: str, budget: int) -> int:
    """Bounded optimal-string-alignment distance for complete entity names."""

    over = budget + 1
    if abs(len(left) - len(right)) > budget:
        return over
    previous_previous = list(range(len(right) + 1))
    previous = list(range(len(right) + 1))
    for line, left_character in enumerate(left, start=1):
        current = [over] * (len(right) + 1)
        current[0] = line
        first = max(1, line - budget)
        last = min(len(right), line + budget)
        cheapest = current[0]
        for column in range(first, last + 1):
            cost = int(left_character != right[column - 1])
            value = min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + cost,
            )
            if (
                line > 1
                and column > 1
                and left_character == right[column - 2]
                and left[line - 2] == right[column - 1]
            ):
                value = min(value, previous_previous[column - 2] + 1)
            current[column] = value
            cheapest = min(cheapest, value)
        if cheapest > budget:
            return over
        previous_previous, previous = previous, current
    return previous[len(right)]


def _aliases(node: dict[str, Any]) -> list[str]:
    return [
        item["alias"]
        for item in node.get("aliases") or []
        if isinstance(item, dict) and isinstance(item.get("alias"), str)
    ]


def resolve_entity(
    figures: dict[str, Any],
    mention: str,
    *,
    entity_type: str | None = None,
    context_ids: Sequence[str] = (),
    vocabulary: Sequence[str] = (),
) -> ResolutionResult:
    """Resolve a mention without guessing across a tied or weak match."""

    normalized = normalize_entity_name(mention)
    if not normalized:
        return ResolutionResult("not_found", mention, None, [])
    nodes = [
        node
        for node in figures.get("nodes") or []
        if isinstance(node, dict)
        and isinstance(node.get("id"), str)
        and (entity_type is None or node.get("type", "person") == entity_type)
    ]
    context = set(context_ids)
    connected = {
        endpoint
        for edge in figures.get("edges") or []
        if isinstance(edge, dict)
        for endpoint, other in (
            (edge.get("from"), edge.get("to")),
            (edge.get("to"), edge.get("from")),
        )
        if other in context and isinstance(endpoint, str)
    }
    known_word = normalized in {normalize_entity_name(word) for word in vocabulary}
    candidates: list[ResolutionCandidate] = []
    for node in nodes:
        reasons: list[str] = []
        score = 0.0
        node_id = node["id"]
        name = normalize_entity_name(node.get("name"))
        aliases = [normalize_entity_name(alias) for alias in _aliases(node)]
        if mention == node_id:
            score, reasons = 1.0, ["exact_id"]
        elif normalized == name:
            score, reasons = 0.99, ["exact_name"]
        elif normalized in aliases:
            score, reasons = 0.98, ["exact_alias"]
        elif not known_word and len(normalized) >= 5 and name and normalized[0] == name[0]:
            budget = edit_budget(len(normalized))
            choices = [(name, "fuzzy_name"), *[(alias, "fuzzy_alias") for alias in aliases]]
            distances = [
                (name_or_alias, reason, name_distance(normalized, name_or_alias, budget))
                for name_or_alias, reason in choices
                if name_or_alias and name_or_alias[0] == normalized[0]
            ]
            if distances:
                _, reason, distance = min(distances, key=lambda item: item[2])
                if distance <= budget:
                    score = 0.80 - distance * 0.05
                    reasons = [reason]
        if not reasons:
            continue
        if entity_type is not None:
            reasons.append("type_match")
        if node_id in connected:
            score += 0.02
            reasons.append("connected_context")
        candidates.append(ResolutionCandidate(node_id, round(score, 3), reasons))

    candidates.sort(key=lambda item: (-item.score, item.element_id))
    if not candidates:
        return ResolutionResult("not_found", mention, None, [])
    best = candidates[0].score
    tied = [candidate for candidate in candidates if candidate.score == best]
    if len(tied) != 1:
        return ResolutionResult("ambiguous", mention, None, tied)
    return ResolutionResult("resolved", mention, tied[0].element_id, candidates)
