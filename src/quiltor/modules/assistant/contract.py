"""Deterministic planning heuristics: classify a question into a task contract (which
proposal kinds are required, what scopes to read, whether it's an audit or a broad
request) before ever asking the model to reason -- and verify afterwards that its
proposals actually satisfied that contract."""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from quiltor.domain.story_world.entity_resolution import ResolutionResult, resolve_entity
from quiltor.modules.assistant.entity_references import entity_mentions, mentioned_entity_ids
from quiltor.modules.assistant.relationship_appearance import (
    normalize_relationship_appearance,
    relationship_appearance_at,
)

# Broad, unscoped creation requests ("search all chapters and create every figure") can
# need more than any single call's context/output budget can safely hold -- these get
# routed to explicit, user-approved batch mode (see AssistantRuntime.complete()'s "broad"
# short-circuit) instead of risking either input overflow or output truncation.
BROAD_SCOPE_REQUEST = re.compile(
    r"\b(alle|sämtlich\w*|mehrere\w*|jed(?:es|e|en)|die\s+ganze|gesamte?|komplette?|all|every|entire|whole|multiple|several)\b"
    r".{0,40}\b(kapitel|manuskript|geschichte|roman|chapters?|manuscript|story|novel)\b"
    # "Kapitel" doesn't inflect for plural in German -- "die/den Kapitel(n)" (plural
    # article) already signals "across chapters" without needing an "alle"-style
    # qualifier, which is exactly the real phrasing that missed the first version of
    # this pattern ("durchsuche die Kapitel und ...").
    r"|\b(?:die|den)\s+kapitel(?:n)?\b"
    r"|\bchapters\b",
    re.IGNORECASE | re.DOTALL,
)


def _normal(value: Any) -> str:
    return re.sub(r"[^\wäöüß]+", " ", str(value or "").casefold()).strip()


def required_proposal_kinds(question: str) -> set[str]:
    folded = question.casefold()
    if re.search(
        r"\b(anwesen\w*|aufenthalt\w*|befind\w*|presence|located|location)\b", folded
    ) and re.search(
        r"\b(setz\w*|änder\w*|aktualisier\w*|markier\w*|set|change|update|propose)\b", folded
    ):
        return {"set_presence"}
    if re.search(
        r"\b(sortier\w*|anordnen|anordnung|arrange|layout|platzier\w*|verschieb\w*)\b", folded
    ):
        return {"arrange_elements"}
    if re.search(
        r"\b(markier\w*|setz\w*)\b.*\b(verstorben|gestorben|tot|todeszeitpunkt)\b", folded
    ):
        return {"mark_deceased"}
    if (
        "beziehung" in folded
        and re.search(r"\b(zeitpunkt|moment|stand|status)\b", folded)
        and re.search(r"\b(änder\w*|setz\w*|aktualisier\w*)\b", folded)
    ):
        return {"set_relationship_at_moment"}
    creation = bool(
        re.search(r"\b(lege|anlegen|anzulegen|erstelle?n?|hinzufügen|create|add)\b", folded)
    )
    requested: set[str] = set()
    if creation and re.search(r"\b(zeitpunkt|timeline|moment|ereignis)\w*\b", folded):
        requested.add("create_timeline_moment")
    if ("beziehung" in folded or "relationship" in folded) and re.search(
        r"\b(schlag\w*|vorschlag|lege|anlegen|anzulegen|erstelle?n?|create|propose)\b", folded
    ):
        requested.add("create_relationship")
    if requested:
        return requested
    if re.search(r"\b(ergänz\w*|aktualisier\w*|änder\w*|update)\b", folded):
        return {"update_element"}
    required: set[str] = set()
    if creation:
        required.add("create_element")
        if re.search(
            r"\b(sohn|tochter|vater|mutter|bruder|schwester|ehefrau|ehemann|partner(?:in)?|gehört|besitzt)\b",
            folded,
        ) or re.search(r"\bhat\s+(?:einen?|eine)\b", folded):
            required.add("create_relationship")
    return required


def task_contract(question: str, figures: dict[str, Any]) -> dict[str, Any]:
    """Build a deterministic contract before asking the model to reason."""
    folded = question.casefold()
    asks_for_audit = bool(
        re.search(r"\b(prüf\w*|validier\w*|konsistent|widerspruch|check)\b", folded)
    )
    content_audit = bool(
        re.search(r"\b(manuskript|kapitel|text|verhalten|motiv\w*|handlung)\b", folded)
    )
    structural_target = bool(
        re.search(
            r"\b(beziehung\w*|relationship\w*|timeline\w*|direction|richtung\w*|zeitst(?:and|ände))\b",
            folded,
        )
    )
    audit = asks_for_audit and structural_target and not content_audit
    scopes: list[str] = []
    if "beziehung" in folded or "relationship" in folded or audit:
        scopes.append("relationships")
    if "timeline" in folded or "zeit" in folded or audit:
        scopes.append("timeline")
    if re.search(r"\b(anwesen\w*|aufenthalt\w*|befind\w*|presence|location)\b", folded):
        scopes.extend(["elements", "timeline", "presence"])
    if re.search(r"\b(element|figur|tier|ort|konzept|board|page)\w*\b", folded) or not scopes:
        scopes.append("elements")
    required = sorted(required_proposal_kinds(question))
    # Only creation/mutation requests get the broad-scope treatment -- a read-only "fasse
    # die ganze Geschichte zusammen" doesn't risk the truncation/overflow this flags.
    # Audits already run as one deterministic pass over all figures, no LLM call, no risk.
    broad = bool(required) and bool(BROAD_SCOPE_REQUEST.search(question)) and not audit
    return {
        "goal": question,
        "audit": audit,
        "broad": broad,
        "readScopes": list(dict.fromkeys(scopes)),
        "requiredKinds": required,
        "expected": contract_expectations(question, required),
        "counts": {
            "elements": len(figures.get("nodes") or []),
            "relationships": len(figures.get("edges") or []),
            "timeline": len(figures.get("timeline") or []),
        },
    }


def contract_expectations(question: str, required: list[str]) -> list[str]:
    expectations = [f"valid {kind}" for kind in required]
    folded = question.casefold()
    if "create_element" in required:
        expectations.extend(
            [
                "new element has a non-empty name",
                "new element does not duplicate an existing element",
            ]
        )
    if "create_relationship" in required:
        expectations.extend(["both endpoints resolve", "relationship is not a duplicate"])
    if re.search(r"\bhat\s+(?:einen?|eine)\b|\b(?:besitzt|gehört)\b", folded):
        expectations.append("created element is connected to its stated owner")
    return expectations


def creation_target_resolution(
    question: str, figures: dict[str, Any], contract: dict[str, Any]
) -> ResolutionResult | None:
    if "create_element" not in contract["requiredKinds"]:
        return None
    folded = question.casefold()
    requested_type = next(
        (
            kind
            for kind, words in {
                "tier": ("tier", "animal"),
                "person": ("figur", "person", "character"),
                "ort": ("ort", "place"),
                "konzept": ("konzept", "concept"),
                "organisation": ("organisation", "organization"),
                "objekt": ("objekt", "object"),
            }.items()
            if any(re.search(rf"\b{word}\w*\b", folded) for word in words)
        ),
        None,
    )
    named_target = re.search(
        r"\b(?:[Ll]ege|[Ee]rstelle?|[Cc]reate|[Aa]dd)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]*)*)\s+(?:als|an\b)",
        question,
    )
    if named_target:
        return resolve_entity(
            figures,
            named_target.group(1),
            entity_type=requested_type,
        )

    mentions = entity_mentions(question, figures, entity_type=requested_type)
    ambiguous = next(
        (mention.resolution for mention in mentions if mention.resolution.status == "ambiguous"),
        None,
    )
    if ambiguous is not None:
        return ambiguous
    resolved = list(
        dict.fromkeys(
            mention.resolution.resolved_id
            for mention in mentions
            if mention.resolution.status == "resolved"
            and mention.resolution.resolved_id is not None
        )
    )
    if not resolved:
        return None
    if len(resolved) == 1:
        return resolve_entity(figures, resolved[0], entity_type=requested_type)
    candidates = [
        candidate
        for element_id in resolved
        for candidate in resolve_entity(
            figures,
            element_id,
            entity_type=requested_type,
        ).candidates[:1]
    ]
    return ResolutionResult(
        "ambiguous",
        question,
        None,
        candidates,
    )


def existing_creation_target(
    question: str, figures: dict[str, Any], contract: dict[str, Any]
) -> dict[str, Any] | None:
    resolution = creation_target_resolution(question, figures, contract)
    if resolution is None or resolution.status != "resolved" or resolution.resolved_id is None:
        return None
    return next(
        (node for node in figures.get("nodes") or [] if node.get("id") == resolution.resolved_id),
        None,
    )


def structured_context(chunks: list[Any], contract: dict[str, Any]) -> list[Any]:
    kind_for_scope = {
        "elements": "element",
        "relationships": "relationship",
        "timeline": "timeline",
    }
    kinds = {kind_for_scope[scope] for scope in contract["readScopes"] if scope in kind_for_scope}
    if not kinds:
        return []
    # Operational reads are exhaustive. RAG is only used later for manuscript evidence.
    return [chunk for chunk in chunks if chunk.kind in kinds]


def _structured_relationship(edge: Any) -> dict[str, Any]:
    if not isinstance(edge, dict):
        return {}
    relationship = {
        key: edge.get(key)
        for key in ("id", "from", "to", "label", "directed", "active")
        if edge.get(key) not in (None, "", [], {})
    }
    relationship.update(
        relationship_appearance_at(edge)
        or {"lineStyle": "solid", "relationshipKind": "general", "color": "auto"}
    )
    versions: list[dict[str, Any]] = []
    for version in edge.get("versions") or []:
        if not isinstance(version, dict):
            continue
        mapped = {
            key: version.get(key)
            for key in ("momentId", "from", "to", "label", "active", "directed")
            if version.get(key) not in (None, "", [], {})
        }
        appearance = normalize_relationship_appearance(version)
        if appearance is not None:
            mapped.update(appearance)
        versions.append(mapped)
    if versions:
        relationship["versions"] = versions
    return relationship


def structured_world_state(figures: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    state: dict[str, Any] = {}
    scopes = set(contract["readScopes"])
    if "elements" in scopes:
        state["elements"] = [
            {
                key: node.get(key)
                for key in ("id", "type", "name", "label", "sub", "profile", "diedMomentId")
                if node.get(key) not in (None, "", [], {})
            }
            for node in figures.get("nodes") or []
        ]
    if "relationships" in scopes:
        state["relationships"] = [
            _structured_relationship(edge) for edge in figures.get("edges") or []
        ]
    if "timeline" in scopes:
        state["timeline"] = [
            {
                key: moment.get(key)
                for key in ("id", "title", "date", "note")
                if moment.get(key) not in (None, "", [], {})
            }
            for moment in figures.get("timeline") or []
        ]
    if "presence" in scopes:
        state["presence"] = [
            {
                key: entry.get(key)
                for key in ("id", "elementId", "placeId", "momentId")
                if entry.get(key) not in (None, "")
            }
            for entry in figures.get("presence") or []
        ]
    return state


def verify_task_contract(
    contract: dict[str, Any],
    proposals: list[dict[str, Any]],
    figures: dict[str, Any],
    *,
    satisfied_kinds: set[str] | frozenset[str] = frozenset(),
) -> dict[str, Any]:
    present = {item.get("kind") for item in proposals} | set(satisfied_kinds)
    missing = [kind for kind in contract["requiredKinds"] if kind not in present]
    issues: list[str] = []
    nodes = {_normal(node.get("name")) for node in figures.get("nodes") or []}
    moments = {
        (_normal(moment.get("title")), _normal(moment.get("date")))
        for moment in figures.get("timeline") or []
    }
    for proposal in proposals:
        if (
            proposal.get("kind") == "create_element"
            and _normal((proposal.get("element") or {}).get("name")) in nodes
        ):
            issues.append("duplicate element")
        if proposal.get("kind") == "create_timeline_moment":
            moment = proposal.get("moment") or {}
            if (_normal(moment.get("title")), _normal(moment.get("date"))) in moments:
                issues.append("duplicate timeline moment")
    if issues:
        missing.extend(issues)
    return {
        "requiredKinds": contract["requiredKinds"],
        "presentKinds": sorted(str(item) for item in present if item),
        "complete": not missing,
        "missing": missing,
        "issues": issues,
    }


def proposal_group_title(question: str) -> str:
    compact = " ".join(question.split())
    return compact[:80] + ("…" if len(compact) > 80 else "")


def complete_compound_proposals(
    question: str,
    proposals: list[dict[str, Any]],
    figures: dict[str, Any],
    *,
    resolved_creation_target: str | None = None,
) -> list[dict[str, Any]]:
    required = required_proposal_kinds(question)
    if required == {"arrange_elements"}:
        return [item for item in proposals if item.get("kind") == "arrange_elements"] or [
            {"kind": "arrange_elements", "strategy": "thematic"}
        ]
    created = next((item for item in proposals if item.get("kind") == "create_element"), None)
    created_reference = created.get("tempId") if created else resolved_creation_target
    if (
        "create_relationship" in required
        and created_reference
        and not any(item.get("kind") == "create_relationship" for item in proposals)
    ):
        folded = question.casefold()
        mentioned_ids = mentioned_entity_ids(question, figures)
        nodes_by_id = {
            str(node.get("id")): node for node in figures.get("nodes") or [] if node.get("id")
        }
        related_ids = [
            identifier
            for identifier in mentioned_ids or []
            if identifier != resolved_creation_target
        ]
        matches = (
            [nodes_by_id[related_ids[0]]]
            if len(related_ids) == 1 and related_ids[0] in nodes_by_id
            else []
        )
        if matches:
            labels = {
                "sohn": "Sohn von",
                "tochter": "Tochter von",
                "vater": "Vater von",
                "mutter": "Mutter von",
                "bruder": "Bruder von",
                "schwester": "Schwester von",
                "ehefrau": "Ehefrau von",
                "ehemann": "Ehemann von",
                "partner": "Partner von",
                "partnerin": "Partnerin von",
            }
            key = next((key for key in labels if key in folded), None)
            ownership = key is None and (
                re.search(r"\bhat\s+(?:einen?|eine)\b", folded)
                or "besitzt" in folded
                or "gehört" in folded
            )
            relationship = (
                {
                    "from": matches[0]["id"],
                    "to": created_reference,
                    "label": "Besitzt",
                    "directed": True,
                    "lineStyle": "solid",
                    "relationshipKind": "general",
                    "color": "auto",
                }
                if ownership
                else {
                    "from": created_reference,
                    "to": matches[0]["id"],
                    "label": labels.get(key or "", "Verwandt mit"),
                    "directed": True,
                    "lineStyle": "solid",
                    "relationshipKind": "kinship" if key else "general",
                    "color": "auto",
                }
            )
            proposals.append({"kind": "create_relationship", "relationship": relationship})
    return proposals


# --- Fitting the world state into its budget (T-307) -------------------------------------------
#
# Each scope keeps its "always" fields. When the state does not fit, the fields of the stages
# below go, one stage at a time, first from every entry that is not relevant to the request;
# then non-relevant entries go entirely (stage 4); then relevant entries lose the same fields,
# lowest rank first (stage 5). Below "relevant entries with their always fields" nothing fits:
# the caller raises the context error (F-307-9). For world extraction every entry stays, since
# the model needs every name to avoid duplicates. Each cut leaves a marker with a count, so the
# model can tell a shortened profile from an empty one.
ALWAYS_FIELDS = {
    "elements": ("id", "type", "name", "diedMomentId"),
    "relationships": ("id", "from", "to", "directed", "active"),
    "timeline": ("id", "title", "date"),
    "presence": ("id", "elementId", "placeId", "momentId"),
}
FIELD_STAGES: dict[str, tuple[tuple[str, ...], ...]] = {
    "elements": (("profile",), ("sub",), ("label",)),
    "relationships": (("versions",), ("lineStyle", "relationshipKind", "color"), ("label",)),
    "timeline": (("note",),),
    "presence": (),
}
TYPE_ORDER = ("person", "figur", "ort", "objekt", "organisation", "gruppe", "tier")
SHORTENED_WORLD_HEADER = (
    'STRUCTURED WORLD STATE (shortened to fit; "shortened" and "truncated" count what was '
    "left out; use read tools for details)"
)
COMPLETE_WORLD_HEADER = "STRUCTURED WORLD STATE (complete for the requested scopes)"


class FittedWorld:
    """A world state that fits its target, and whether anything was left out."""

    def __init__(self, state: dict[str, Any], tokens: int, shortened: bool) -> None:
        self.state = state
        self.tokens = tokens
        self.shortened = shortened

    @property
    def header(self) -> str:
        return SHORTENED_WORLD_HEADER if self.shortened else COMPLETE_WORLD_HEADER


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _type_rank(entry: dict[str, Any]) -> int:
    kind = str(entry.get("type") or "")
    return TYPE_ORDER.index(kind) if kind in TYPE_ORDER else len(TYPE_ORDER)


class _ScopeFit:
    def __init__(
        self, scope: str, entries: list[Any], relevant: Sequence[str], count: Callable[[str], int]
    ) -> None:
        self.scope = scope
        self.entries = [dict(entry) if isinstance(entry, dict) else entry for entry in entries]
        self.count = count
        self.tokens = [count(_dump(entry)) for entry in self.entries]
        self.removed: set[int] = set()
        self.shortened: dict[str, int] = {}
        rank = {ident: position for position, ident in enumerate(dict.fromkeys(relevant))}
        ids = [str(entry.get("id")) if isinstance(entry, dict) else "" for entry in self.entries]
        self.relevant = sorted(
            (index for index, ident in enumerate(ids) if ident in rank),
            key=lambda index: rank[ids[index]],
        )
        relevant_set = set(self.relevant)
        # Lowest priority first: the order in which entries lose fields and then go.
        self.others = sorted(
            (index for index in range(len(self.entries)) if index not in relevant_set),
            key=lambda index: (_type_rank(self.entries[index]), ids[index]),
            reverse=True,
        )

    def size(self) -> int:
        return sum(tokens for index, tokens in enumerate(self.tokens) if index not in self.removed)

    def drop_fields(self, index: int, fields: tuple[str, ...]) -> None:
        entry = self.entries[index]
        if not isinstance(entry, dict):
            return
        changed = False
        for field in fields:
            if field in entry:
                del entry[field]
                self.shortened[field] = self.shortened.get(field, 0) + 1
                changed = True
        if changed:
            self.tokens[index] = self.count(_dump(entry))

    def stages(self) -> tuple[tuple[str, ...], ...]:
        # The named stages, then everything else that is not an "always" field.
        named = FIELD_STAGES.get(self.scope, ())
        listed = {field for stage in named for field in stage}
        always = ALWAYS_FIELDS.get(self.scope, ())
        rest = sorted(
            {
                field
                for entry in self.entries
                if isinstance(entry, dict)
                for field in entry
                if field not in always and field not in listed
            }
        )
        return (*named, tuple(rest)) if rest else named

    def fit(self, target: int, keep_all_entries: bool) -> bool:
        if self.size() <= target:
            return True
        stages = self.stages()
        others = self.others
        for fields in stages:
            for index in others:
                self.drop_fields(index, fields)
            if self.size() <= target:
                return True
        if not keep_all_entries:
            for index in others:
                self.removed.add(index)
                if self.size() <= target:
                    return True
        for fields in stages:
            for index in reversed(self.relevant):
                self.drop_fields(index, fields)
                if self.size() <= target:
                    return True
        return self.size() <= target

    def result(self) -> list[Any]:
        return [entry for index, entry in enumerate(self.entries) if index not in self.removed]


def fit_world_state(
    figures: dict[str, Any],
    contract: dict[str, Any],
    *,
    target: int,
    count: Callable[[str], int],
    relevant: Mapping[str, Sequence[str]] | None = None,
    keep_all_entries: bool = False,
) -> FittedWorld | None:
    """The world state of ``contract`` in at most ``target`` tokens, or None below its floor.

    ``relevant`` names, per scope, the ids the request is about, highest rank first; relevance
    holds within its own scope only. The output keeps the world's own order.
    """
    full = structured_world_state(figures, contract)
    full_tokens = count(_dump(full))
    if full_tokens <= target:
        return FittedWorld(full, full_tokens, False)
    relevant = relevant or {}
    fits = {
        scope: _ScopeFit(scope, list(entries), relevant.get(scope, ()), count)
        for scope, entries in full.items()
    }
    # Each scope first gets its floor -- what is left once it has shrunk as far as it can, which
    # for a scope of "always" fields only (presence) is its full size. The rest of the target is
    # shared in proportion to what each scope can still lose; what one leaves goes to the next.
    # Smaller scopes first, so their leftovers reach the large ones.
    floors: dict[str, int] = {}
    for scope, entries in full.items():
        probe = _ScopeFit(scope, list(entries), relevant.get(scope, ()), count)
        probe.fit(0, keep_all_entries)
        floors[scope] = probe.size()
    spare = target - sum(floors.values())
    if spare < 0:
        return None
    total = sum(fit.size() - floors[scope] for scope, fit in fits.items()) or 1
    carry = 0
    for scope in sorted(fits, key=lambda name: fits[name].size()):
        fit = fits[scope]
        share = floors[scope] + spare * (fit.size() - floors[scope]) // total + carry
        if not fit.fit(share, keep_all_entries):
            return None
        carry = share - fit.size()
    state: dict[str, Any] = {scope: fits[scope].result() for scope in full}
    shortened = {scope: fit.shortened for scope, fit in fits.items() if fit.shortened}
    truncated = {scope: len(fit.removed) for scope, fit in fits.items() if fit.removed}
    if shortened:
        state["shortened"] = shortened
    if truncated:
        state["truncated"] = truncated
    return FittedWorld(state, count(_dump(state)), bool(shortened or truncated))
