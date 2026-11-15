"""Deterministic matching of assistant proposals against the T-289 gold set, and its metrics.

Pure functions, standard library only. No model and no LLM judge: every decision below follows a
fixed rule, so the same proposals always give the same numbers (plan T-289 r5, sections 4 and 6).

A task is one question put to the assistant:

    {
      "id": "extract:g-ch-alias", "kind": "extract" | "missing", "mode": "A" | "B",
      "gold": [entry, ...],              # what the assistant should find
      "known": [{"id", "type", "names"}],  # elements already in the world (mode B, missing)
      "knownRelationships": {id: {"from", "to"}},
      "titles": ["hauptmann", ...],      # title words dropped when comparing partial names
    }

A gold entry carries `id`, `category` and `required` plus, by category:
  figure / place / thing: `types` (accepted element types) and `names` (first = the name, rest = aliases)
  relation: `from`, `to` (gold element ids), `directed`, `relationshipKind`, `synonyms`
  event: `keywords`, `refs` (gold element ids), optional `date`
  presence: `element`, `place` (gold element ids)
"""

from __future__ import annotations

import datetime
import math
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

ELEMENT_CATEGORIES = ("figure", "place", "thing")
CATEGORIES = (*ELEMENT_CATEGORIES, "relation", "event", "presence")

# A partial match counts half a hit, half a false positive and half a miss (F-289-1).
PARTIAL = 0.5

# Language data, one literal per language: German words, not English misspellings.
ARTICLES_DE = "der die das den dem des ein eine einen einem"
ARTICLES_EN = "the a an"
ARTICLES = frozenset(f"{ARTICLES_DE} {ARTICLES_EN}".split())

# Month names in calendar order; "jänner" is the Austrian January.
MONTHS_DE = "januar februar märz april mai juni juli august september oktober november dezember"
MONTHS_EN = "january february march april may june july august september october november december"
MONTHS = {
    **{name: number for number, name in enumerate(MONTHS_DE.split(), start=1)},
    **{name: number for number, name in enumerate(MONTHS_EN.split(), start=1)},
    "jänner": 1,
}

STRENGTH_NAME, STRENGTH_ALIAS, STRENGTH_PARTIAL_NAME = 0, 1, 2


# --- normalisation -----------------------------------------------------------------------------


def tokens(text: Any) -> tuple[str, ...]:
    """NFKC, casefold (which also turns ß into ss), punctuation to space, split."""
    value = unicodedata.normalize("NFKC", str(text or "")).casefold()
    value = re.sub(r"[^\w]+", " ", value).replace("_", " ")
    return tuple(value.split())


def normalize(text: Any) -> str:
    """The comparable form of a name: tokens without leading articles."""
    words = list(tokens(text))
    while words and words[0] in ARTICLES:
        words.pop(0)
    return " ".join(words)


def core_tokens(text: Any, titles: Iterable[str]) -> frozenset[str]:
    """The words that identify a name: no articles, no title words."""
    drop = ARTICLES | {normalize(title) for title in titles}
    return frozenset(word for word in tokens(text) if word not in drop)


def contains_sequence(haystack: Sequence[str], needle: Sequence[str]) -> bool:
    if not needle:
        return False
    width = len(needle)
    return any(
        tuple(haystack[i : i + width]) == tuple(needle) for i in range(len(haystack) - width + 1)
    )


# --- dates -------------------------------------------------------------------------------------


def parse_absolute_date(text: Any) -> datetime.date | None:
    """ISO YYYY-MM-DD or "D. Monat YYYY" / "D Month YYYY" / "Month D, YYYY"; anything else is None."""
    value = unicodedata.normalize("NFKC", str(text or "")).strip().casefold()
    try:
        match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", value)
        if match:
            return datetime.date(int(match[1]), int(match[2]), int(match[3]))
        match = re.fullmatch(r"(\d{1,2})\.?\s+(\w+)\s+(\d{1,4})", value)
        if match and match[2] in MONTHS:
            return datetime.date(int(match[3]), MONTHS[match[2]], int(match[1]))
        match = re.fullmatch(r"(\w+)\s+(\d{1,2}),?\s+(\d{1,4})", value)
        if match and match[1] in MONTHS:
            return datetime.date(int(match[3]), MONTHS[match[1]], int(match[2]))
    except ValueError:
        return None
    return None


def date_within_tolerance(gold_date: Any, proposed: Any, days: int = 1) -> bool:
    """True when the proposal's date does not contradict the gold date.

    Only absolute gold dates are checked; relative ones are not parsed (D-213). An empty or
    unparsable proposed date counts as empty.
    """
    expected = parse_absolute_date(gold_date)
    if expected is None:
        return True
    actual = parse_absolute_date(proposed)
    if actual is None:
        return True
    return abs((actual - expected).days) <= days


# --- counting ----------------------------------------------------------------------------------


def empty_counts() -> dict[str, dict[str, float]]:
    return {category: {"tp": 0.0, "fp": 0.0, "fn": 0.0} for category in CATEGORIES}


def category_for_type(element_type: Any) -> str:
    value = normalize(element_type)
    if value in {"figur", "figure", "person", "character"}:
        return "figure"
    if value in {"ort", "place", "location"}:
        return "place"
    return "thing"


class _Ledger:
    def __init__(self) -> None:
        self.counts = empty_counts()
        self.optional_found = 0
        self.off_task = 0
        self.updates = 0
        self.matches: list[dict[str, Any]] = []

    def hit(self, entry: Mapping[str, Any], proposal_index: int, partial: bool) -> None:
        category = entry["category"]
        self.matches.append({"gold": entry["id"], "proposal": proposal_index, "partial": partial})
        if not entry.get("required", True):
            self.optional_found += 1
            return
        bucket = self.counts[category]
        if partial:
            bucket["tp"] += PARTIAL
            bucket["fp"] += PARTIAL
            bucket["fn"] += PARTIAL
        else:
            bucket["tp"] += 1

    def false_positive(self, category: str) -> None:
        self.counts[category]["fp"] += 1

    def miss(self, entry: Mapping[str, Any]) -> None:
        if entry.get("required", True):
            self.counts[entry["category"]]["fn"] += 1


def _assign(
    candidates: list[tuple[tuple[int, int, int], int, int, bool]],
) -> list[tuple[int, int, bool]]:
    """Global two-phase assignment: every full match first, then partial ones (F-289-4).

    A candidate is (order key, gold index, proposal index, partial). Within a phase the order key
    decides; each gold entry and each proposal is used at most once.
    """
    used_gold: set[int] = set()
    used_proposal: set[int] = set()
    result: list[tuple[int, int, bool]] = []
    for phase_partial in (False, True):
        phase = sorted(c for c in candidates if c[3] == phase_partial)
        for _key, gold_index, proposal_index, partial in phase:
            if gold_index in used_gold or proposal_index in used_proposal:
                continue
            used_gold.add(gold_index)
            used_proposal.add(proposal_index)
            result.append((gold_index, proposal_index, partial))
    return result


# --- matching ----------------------------------------------------------------------------------


def _name_strength(
    name: str,
    entry: Mapping[str, Any],
    unique_partial: Mapping[str, str | None],
    titles: Sequence[str],
) -> int | None:
    normalized = normalize(name)
    names = [normalize(item) for item in entry.get("names") or []]
    if not normalized:
        return None
    if names and normalized == names[0]:
        return STRENGTH_NAME
    if normalized in names[1:]:
        return STRENGTH_ALIAS
    if unique_partial.get(normalized) == entry["id"]:
        return STRENGTH_PARTIAL_NAME
    return None


def _partial_owner(
    name: str, entries: Sequence[Mapping[str, Any]], titles: Sequence[str]
) -> str | None:
    """The one gold entry of the task whose name contains every core word of `name`, else None."""
    words = core_tokens(name, titles)
    if not words:
        return None
    owners = {
        entry["id"]
        for entry in entries
        for gold_name in entry.get("names") or []
        if words <= core_tokens(gold_name, titles)
    }
    return next(iter(owners)) if len(owners) == 1 else None


def _proposal_name(proposal: Mapping[str, Any]) -> str:
    element = proposal.get("element") or {}
    return str(element.get("name") or element.get("label") or "")


def match_task(task: Mapping[str, Any], proposals: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Match one task's proposals against its gold set. Returns counts and the side tallies."""
    kind = task.get("kind", "extract")
    titles = list(task.get("titles") or [])
    gold = list(task.get("gold") or [])
    known = list(task.get("known") or [])
    known_relationships = dict(task.get("knownRelationships") or {})
    ledger = _Ledger()

    elements = [entry for entry in gold if entry["category"] in ELEMENT_CATEGORIES]
    named = elements + [
        {
            "id": item["id"],
            "category": category_for_type(item.get("type")),
            "names": item.get("names"),
        }
        for item in known
    ]
    known_ids = {item["id"] for item in known}

    creates: list[int] = []
    for index, proposal in enumerate(proposals):
        proposal_kind = proposal.get("kind")
        if proposal_kind == "update_element":
            ledger.updates += 1
        elif proposal_kind == "create_element":
            element_type = (proposal.get("element") or {}).get("type")
            if kind == "missing" and category_for_type(element_type) != "figure":
                ledger.off_task += 1
            else:
                creates.append(index)
        elif kind == "missing" or proposal_kind not in {
            "create_relationship",
            "set_relationship_at_moment",
            "create_timeline_moment",
            "set_presence",
        }:
            ledger.off_task += 1

    # Elements (4.2).
    partial_owner_cache: dict[str, str | None] = {}
    candidates = []
    for proposal_index in creates:
        proposal = proposals[proposal_index]
        name = _proposal_name(proposal)
        normalized = normalize(name)
        if normalized not in partial_owner_cache:
            partial_owner_cache[normalized] = _partial_owner(name, named, titles)
        element_type = normalize((proposal.get("element") or {}).get("type"))
        for gold_index, entry in enumerate(elements):
            strength = _name_strength(name, entry, partial_owner_cache, titles)
            if strength is None:
                continue
            type_ok = element_type in {normalize(item) for item in entry.get("types") or []}
            candidates.append(
                ((strength, gold_index, proposal_index), gold_index, proposal_index, not type_ok)
            )
    assigned = _assign(candidates)
    resolved_temp: dict[str, str] = {}
    matched_gold = set()
    matched_proposals = set()
    for gold_index, proposal_index, partial in assigned:
        entry = elements[gold_index]
        ledger.hit(entry, proposal_index, partial)
        matched_gold.add(gold_index)
        matched_proposals.add(proposal_index)
        temp_id = proposals[proposal_index].get("tempId")
        if temp_id:
            resolved_temp[str(temp_id)] = entry["id"]
    for proposal_index in creates:
        if proposal_index in matched_proposals:
            continue
        element_type = (proposals[proposal_index].get("element") or {}).get("type")
        ledger.false_positive(category_for_type(element_type))
    for gold_index, entry in enumerate(elements):
        if gold_index not in matched_gold:
            ledger.miss(entry)

    gold_element_ids = {entry["id"] for entry in elements} | known_ids

    def resolve(endpoint: Any) -> str | None:
        value = str(endpoint or "")
        if value in resolved_temp:
            return resolved_temp[value]
        if value in gold_element_ids:
            return value
        return None

    if kind != "missing":
        _match_relations(gold, proposals, resolve, known_relationships, ledger)
        _match_events(gold, proposals, elements + named, ledger)
        _match_presence(gold, proposals, resolve, ledger)

    return {
        "id": task.get("id"),
        "kind": kind,
        "mode": task.get("mode", "A"),
        "counts": ledger.counts,
        "optionalFound": ledger.optional_found,
        "offTask": ledger.off_task,
        "updates": ledger.updates,
        "matches": ledger.matches,
    }


def _match_relations(gold, proposals, resolve, known_relationships, ledger: _Ledger) -> None:
    entries = [entry for entry in gold if entry["category"] == "relation"]
    shapes: list[tuple[int, dict[str, Any] | None]] = []
    for index, proposal in enumerate(proposals):
        if proposal.get("kind") == "create_relationship":
            shapes.append((index, dict(proposal.get("relationship") or {})))
        elif proposal.get("kind") == "set_relationship_at_moment":
            base = known_relationships.get(str(proposal.get("relationshipId")))
            patch = dict(proposal.get("patch") or {})
            shapes.append((index, {**base, **patch} if base else None))
    candidates = []
    unresolved = []
    for index, shape in shapes:
        if shape is None:
            unresolved.append(index)
            continue
        source = resolve(shape.get("from"))
        target = resolve(shape.get("to"))
        if source is None or target is None:
            unresolved.append(index)
            continue
        label = tokens(shape.get("label"))
        directed = bool(shape.get("directed"))
        relation_kind = shape.get("relationshipKind") or "general"
        for gold_index, entry in enumerate(entries):
            same = (source, target) == (entry["from"], entry["to"])
            swapped = (source, target) == (entry["to"], entry["from"])
            if not (same or swapped):
                continue
            if swapped and entry.get("directed") and source != target:
                full = False
            else:
                synonym = any(
                    contains_sequence(label, tokens(item)) for item in entry.get("synonyms") or []
                )
                full = (
                    synonym
                    and directed == bool(entry.get("directed"))
                    and relation_kind == (entry.get("relationshipKind") or "general")
                )
            candidates.append(((0, gold_index, index), gold_index, index, not full))
    _settle(entries, [index for index, _shape in shapes], candidates, "relation", ledger)


def _match_events(gold, proposals, named, ledger: _Ledger) -> None:
    entries = [entry for entry in gold if entry["category"] == "event"]
    names_by_id: dict[str, list[tuple[str, ...]]] = {}
    for item in named:
        names_by_id.setdefault(item["id"], []).extend(
            tokens(name) for name in item.get("names") or []
        )
    indices = []
    candidates = []
    for index, proposal in enumerate(proposals):
        if proposal.get("kind") != "create_timeline_moment":
            continue
        indices.append(index)
        moment = proposal.get("moment") or {}
        title = tokens(moment.get("title"))
        note = tokens(moment.get("note"))
        for gold_index, entry in enumerate(entries):
            keyword = any(
                contains_sequence(title, tokens(item)) for item in entry.get("keywords") or []
            )
            if not keyword:
                continue
            reference = any(
                contains_sequence(title, name) or contains_sequence(note, name)
                for ref in entry.get("refs") or []
                for name in names_by_id.get(ref, [])
            )
            full = reference and date_within_tolerance(entry.get("date"), moment.get("date"))
            candidates.append(((0, gold_index, index), gold_index, index, not full))
    _settle(entries, indices, candidates, "event", ledger)


def _match_presence(gold, proposals, resolve, ledger: _Ledger) -> None:
    entries = [entry for entry in gold if entry["category"] == "presence"]
    indices = []
    candidates = []
    for index, proposal in enumerate(proposals):
        if proposal.get("kind") != "set_presence":
            continue
        indices.append(index)
        pair = (resolve(proposal.get("elementId")), resolve(proposal.get("placeId")))
        for gold_index, entry in enumerate(entries):
            if pair == (entry["element"], entry["place"]):
                candidates.append(((0, gold_index, index), gold_index, index, False))
    _settle(entries, indices, candidates, "presence", ledger)


def _settle(entries, proposal_indices, candidates, category, ledger: _Ledger) -> None:
    assigned = _assign(candidates)
    matched_gold = {gold_index for gold_index, _p, _partial in assigned}
    matched_proposals = {proposal_index for _g, proposal_index, _partial in assigned}
    for gold_index, proposal_index, partial in assigned:
        ledger.hit(entries[gold_index], proposal_index, partial)
    for index in proposal_indices:
        if index not in matched_proposals:
            ledger.false_positive(category)
    for gold_index, entry in enumerate(entries):
        if gold_index not in matched_gold:
            ledger.miss(entry)


# --- metrics -----------------------------------------------------------------------------------


def scores(tp: float, fp: float, fn: float) -> dict[str, float | None]:
    """P, R and F1 = 2TP / (2TP + FP + FN); None only where the denominator is empty (F-289-3)."""
    return {
        "p": tp / (tp + fp) if tp + fp else None,
        "r": tp / (tp + fn) if tp + fn else None,
        "f1": 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else None,
    }


def run_metrics(
    results: Sequence[Mapping[str, Any]], tasks: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    """Metrics of one run over all its tasks.

    Counts are summed per category over the tasks, then scored. In mode B only `missing` tasks
    enter P/R/F1; an `extract` B task has no gold, and its false positives go to
    `falsePositives` alone (F-289-15).
    """
    sums = empty_counts()
    false_positives = {category: 0.0 for category in CATEGORIES}
    required = {category: 0 for category in CATEGORIES}
    scored = False
    extras = {"optionalFound": 0, "offTask": 0, "updates": 0}
    for result, task in zip(results, tasks, strict=True):
        for key in extras:
            extras[key] += result.get(key, 0)
        if result.get("mode") == "B" and result.get("kind") == "extract":
            for category in CATEGORIES:
                false_positives[category] += result["counts"][category]["fp"]
            continue
        scored = True
        for category in CATEGORIES:
            for key in ("tp", "fp", "fn"):
                sums[category][key] += result["counts"][category][key]
        for entry in task.get("gold") or []:
            if entry.get("required", True):
                required[entry["category"]] += 1
    per_category = {
        category: {**sums[category], **scores(**sums[category])} for category in CATEGORIES
    }
    total = {key: sum(sums[category][key] for category in CATEGORIES) for key in ("tp", "fp", "fn")}
    macro_values = [
        per_category[category]["f1"] for category in CATEGORIES if required[category] > 0
    ]
    metrics: dict[str, Any] = {
        "perCategory": per_category if scored else None,
        "micro": {**total, **scores(**total)} if scored else None,
        "macro": {"f1": sum(macro_values) / len(macro_values)} if macro_values else {"f1": None},
        **extras,
    }
    if any(result.get("mode") == "B" for result in results):
        metrics["falsePositives"] = false_positives
    return metrics


def spread(values: Iterable[float | None]) -> dict[str, float | int | None]:
    """Mean, sample standard deviation (n-1), min and max of the non-None values."""
    present = [float(value) for value in values if value is not None]
    if not present:
        return {"mean": None, "sd": None, "min": None, "max": None, "n": 0}
    mean = sum(present) / len(present)
    sd = (
        math.sqrt(sum((value - mean) ** 2 for value in present) / (len(present) - 1))
        if len(present) > 1
        else None
    )
    return {"mean": mean, "sd": sd, "min": min(present), "max": max(present), "n": len(present)}
