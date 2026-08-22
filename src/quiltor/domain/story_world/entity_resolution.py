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
MINIMUM_FUZZY_LENGTH = 5
EXACT_ID_SCORE = 1.0
EXACT_TEXT_SCORE = 0.99
FUZZY_SCORE = 0.80
CONTEXT_SCORE = 0.02


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


@dataclass(frozen=True)
class _CandidateMatch:
    candidate: ResolutionCandidate
    context_reasons: tuple[str, ...]


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


def _context_connections(figures: dict[str, Any], context: set[str]) -> set[str]:
    return {
        endpoint
        for edge in figures.get("edges") or []
        if isinstance(edge, dict)
        for endpoint, other in (
            (edge.get("from"), edge.get("to")),
            (edge.get("to"), edge.get("from")),
        )
        if other in context and isinstance(endpoint, str)
    }


def _context_reasons(node_id: str, context: set[str], connected: set[str]) -> tuple[str, ...]:
    reasons: list[str] = []
    if node_id in context:
        reasons.append("local_context")
    if node_id in connected:
        reasons.append("connected_context")
    return tuple(reasons)


def _match_node(
    node: dict[str, Any],
    mention: str,
    normalized: str,
    *,
    fuzzy_allowed: bool,
    type_filtered: bool,
) -> ResolutionCandidate | None:
    node_id = node["id"]
    name = normalize_entity_name(node.get("name"))
    aliases = [alias for value in _aliases(node) if (alias := normalize_entity_name(value))]
    reasons: list[str] = []
    score = 0.0

    if mention == node_id:
        score = EXACT_ID_SCORE
        reasons.append("exact_id")
    else:
        if normalized == name:
            reasons.append("exact_name")
        if normalized in aliases:
            reasons.append("exact_alias")
        if reasons:
            score = EXACT_TEXT_SCORE
        elif fuzzy_allowed:
            budget = edit_budget(len(normalized))
            choices = [(name, "fuzzy_name"), *[(alias, "fuzzy_alias") for alias in aliases]]
            distances = [
                (candidate, reason, name_distance(normalized, candidate, budget))
                for candidate, reason in choices
                if candidate and candidate[0] == normalized[0]
            ]
            if distances:
                nearest = min(distance for _, _, distance in distances)
                if nearest <= budget:
                    score = FUZZY_SCORE - nearest * 0.05
                    for _candidate, reason, distance in distances:
                        if distance == nearest and reason not in reasons:
                            reasons.append(reason)

    if not reasons:
        return None
    if type_filtered:
        reasons.append("type_match")
    return ResolutionCandidate(node_id, round(score, 3), reasons)


def _with_context(match: _CandidateMatch) -> ResolutionCandidate:
    candidate = match.candidate
    return ResolutionCandidate(
        candidate.element_id,
        round(candidate.score + CONTEXT_SCORE, 3),
        [*candidate.reasons, *match.context_reasons],
    )


def _ordered(candidates: Sequence[ResolutionCandidate]) -> list[ResolutionCandidate]:
    return sorted(candidates, key=lambda item: (-item.score, item.element_id))


def resolve_entity(
    figures: dict[str, Any],
    mention: str,
    *,
    entity_type: str | None = None,
    context_ids: Sequence[str] = (),
    vocabulary: Sequence[str] = (),
) -> ResolutionResult:
    """Resolve a mention without guessing across a tied or weak match.

    Exact textual identity collisions are always ambiguous. Local context is only
    allowed to break a fuzzy score tie when exactly one tied candidate is local or
    directly connected to a local entity.
    """

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
    context = {node_id for node_id in context_ids if isinstance(node_id, str)}
    connected = _context_connections(figures, context)
    normalized_vocabulary = {word for value in vocabulary if (word := normalize_entity_name(value))}
    fuzzy_allowed = len(normalized) >= MINIMUM_FUZZY_LENGTH and normalized not in (
        normalized_vocabulary
    )

    matches: list[_CandidateMatch] = []
    for node in nodes:
        candidate = _match_node(
            node,
            mention,
            normalized,
            fuzzy_allowed=fuzzy_allowed,
            type_filtered=entity_type is not None,
        )
        if candidate is not None:
            matches.append(
                _CandidateMatch(
                    candidate,
                    _context_reasons(candidate.element_id, context, connected),
                )
            )

    if not matches:
        return ResolutionResult("not_found", mention, None, [])

    ordered_matches = sorted(
        matches,
        key=lambda item: (-item.candidate.score, item.candidate.element_id),
    )
    best_score = ordered_matches[0].candidate.score
    tied = [match for match in ordered_matches if match.candidate.score == best_score]
    if len(tied) == 1:
        candidates = _ordered([match.candidate for match in matches])
        return ResolutionResult("resolved", mention, tied[0].candidate.element_id, candidates)

    exact_text_collision = any(
        reason in {"exact_name", "exact_alias"}
        for match in tied
        for reason in match.candidate.reasons
    )
    if exact_text_collision:
        return ResolutionResult(
            "ambiguous",
            mention,
            None,
            _ordered([match.candidate for match in tied]),
        )

    contextual = [match for match in tied if match.context_reasons]
    if contextual:
        contextual_candidates = _ordered([_with_context(match) for match in contextual])
        if len(contextual) == 1:
            contextual_id = contextual[0].candidate.element_id
            candidates = [
                _with_context(match)
                if match.candidate.element_id == contextual_id
                else match.candidate
                for match in matches
            ]
            return ResolutionResult(
                "resolved",
                mention,
                contextual_id,
                _ordered(candidates),
            )
        return ResolutionResult("ambiguous", mention, None, contextual_candidates)

    return ResolutionResult(
        "ambiguous",
        mention,
        None,
        _ordered([match.candidate for match in tied]),
    )


__all__ = [
    "ENTITY_ALIAS_NORMALIZATION_V1",
    "ResolutionCandidate",
    "ResolutionResult",
    "ResolutionStatus",
    "edit_budget",
    "name_distance",
    "normalize_entity_name",
    "resolve_entity",
]
