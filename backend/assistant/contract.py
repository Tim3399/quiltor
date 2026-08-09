"""Deterministic planning heuristics: classify a question into a task contract (which
proposal kinds are required, what scopes to read, whether it's an audit or a broad
request) before ever asking the model to reason -- and verify afterwards that its
proposals actually satisfied that contract."""

from __future__ import annotations

import re
from typing import Any

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
    if re.search(r"\b(sortier\w*|anordnen|anordnung|arrange|layout|platzier\w*|verschieb\w*)\b", folded):
        return {"arrange_elements"}
    if re.search(r"\b(markier\w*|setz\w*)\b.*\b(verstorben|gestorben|tot|todeszeitpunkt)\b", folded):
        return {"mark_deceased"}
    if "beziehung" in folded and re.search(r"\b(zeitpunkt|moment|stand|status)\b", folded) and re.search(r"\b(änder\w*|setz\w*|aktualisier\w*)\b", folded):
        return {"set_relationship_at_moment"}
    creation = bool(re.search(r"\b(lege|anlegen|anzulegen|erstelle?n?|hinzufügen|create|add)\b", folded))
    requested: set[str] = set()
    if creation and re.search(r"\b(zeitpunkt|timeline|moment|ereignis)\w*\b", folded):
        requested.add("create_timeline_moment")
    if ("beziehung" in folded or "relationship" in folded) and re.search(r"\b(schlag\w*|vorschlag|lege|anlegen|anzulegen|erstelle?n?|create|propose)\b", folded):
        requested.add("create_relationship")
    if requested:
        return requested
    if re.search(r"\b(ergänz\w*|aktualisier\w*|änder\w*|update)\b", folded):
        return {"update_element"}
    required: set[str] = set()
    if creation:
        required.add("create_element")
        if re.search(r"\b(sohn|tochter|vater|mutter|bruder|schwester|ehefrau|ehemann|partner(?:in)?|gehört|besitzt)\b", folded) or re.search(r"\bhat\s+(?:einen?|eine)\b", folded):
            required.add("create_relationship")
    return required


def task_contract(question: str, figures: dict[str, Any]) -> dict[str, Any]:
    """Build a deterministic contract before asking the model to reason."""
    folded = question.casefold()
    asks_for_audit = bool(re.search(r"\b(prüf\w*|validier\w*|konsistent|widerspruch|check)\b", folded))
    content_audit = bool(re.search(r"\b(manuskript|kapitel|text|verhalten|motiv\w*|handlung)\b", folded))
    structural_target = bool(re.search(r"\b(beziehung\w*|relationship\w*|timeline\w*|direction|richtung\w*|zeitst(?:and|ände))\b", folded))
    audit = asks_for_audit and structural_target and not content_audit
    scopes: list[str] = []
    if "beziehung" in folded or "relationship" in folded or audit:
        scopes.append("relationships")
    if "timeline" in folded or "zeit" in folded or audit:
        scopes.append("timeline")
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
        "counts": {"elements": len(figures.get("nodes") or []), "relationships": len(figures.get("edges") or []), "timeline": len(figures.get("timeline") or [])},
    }


def contract_expectations(question: str, required: list[str]) -> list[str]:
    expectations = [f"valid {kind}" for kind in required]
    folded = question.casefold()
    if "create_element" in required:
        expectations.extend(["new element has a non-empty name", "new element does not duplicate an existing element"])
    if "create_relationship" in required:
        expectations.extend(["both endpoints resolve", "relationship is not a duplicate"])
    if re.search(r"\bhat\s+(?:einen?|eine)\b|\b(?:besitzt|gehört)\b", folded):
        expectations.append("created element is connected to its stated owner")
    return expectations


def existing_creation_target(question: str, figures: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any] | None:
    if "create_element" not in contract["requiredKinds"]:
        return None
    folded = question.casefold()
    requested_type = next((kind for kind, words in {
        "tier": ("tier", "animal"), "person": ("figur", "person", "character"), "ort": ("ort", "place"),
        "konzept": ("konzept", "concept"), "organisation": ("organisation", "organization"), "objekt": ("objekt", "object"),
    }.items() if any(re.search(rf"\b{word}\w*\b", folded) for word in words)), None)
    candidates = [node for node in figures.get("nodes") or [] if not requested_type or node.get("type", "person") == requested_type]
    candidates.sort(key=lambda node: len(str(node.get("name", ""))), reverse=True)
    return next((node for node in candidates if len(_normal(node.get("name"))) >= 3 and re.search(rf"\b{re.escape(_normal(node.get('name')))}\b", _normal(question))), None)


def structured_context(chunks: list[Any], contract: dict[str, Any]) -> list[Any]:
    kind_for_scope = {"elements": "element", "relationships": "relationship", "timeline": "timeline"}
    kinds = {kind_for_scope[scope] for scope in contract["readScopes"] if scope in kind_for_scope}
    if not kinds:
        return []
    # Operational reads are exhaustive. RAG is only used later for manuscript evidence.
    return [chunk for chunk in chunks if chunk.kind in kinds]


def structured_world_state(figures: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    state: dict[str, Any] = {}
    scopes = set(contract["readScopes"])
    if "elements" in scopes:
        state["elements"] = [{key: node.get(key) for key in ("id", "type", "name", "label", "sub", "profile", "diedMomentId") if node.get(key) not in (None, "", [], {})} for node in figures.get("nodes") or []]
    if "relationships" in scopes:
        state["relationships"] = [{key: edge.get(key) for key in ("id", "from", "to", "label", "gerichtet", "style", "versions") if edge.get(key) not in (None, "", [], {})} for edge in figures.get("edges") or []]
    if "timeline" in scopes:
        state["timeline"] = [{key: moment.get(key) for key in ("id", "title", "date", "note") if moment.get(key) not in (None, "", [], {})} for moment in figures.get("timeline") or []]
    return state


def verify_task_contract(contract: dict[str, Any], proposals: list[dict[str, Any]], figures: dict[str, Any]) -> dict[str, Any]:
    present = {item.get("kind") for item in proposals}
    missing = [kind for kind in contract["requiredKinds"] if kind not in present]
    issues: list[str] = []
    nodes = {_normal(node.get("name")) for node in figures.get("nodes") or []}
    moments = {(_normal(moment.get("title")), _normal(moment.get("date"))) for moment in figures.get("timeline") or []}
    for proposal in proposals:
        if proposal.get("kind") == "create_element" and _normal((proposal.get("element") or {}).get("name")) in nodes:
            issues.append("duplicate element")
        if proposal.get("kind") == "create_timeline_moment":
            moment = proposal.get("moment") or {}
            if (_normal(moment.get("title")), _normal(moment.get("date"))) in moments:
                issues.append("duplicate timeline moment")
    if issues:
        missing.extend(issues)
    return {"requiredKinds": contract["requiredKinds"], "presentKinds": sorted(str(item) for item in present if item), "complete": not missing, "missing": missing, "issues": issues}


def proposal_group_title(question: str) -> str:
    compact = " ".join(question.split())
    return compact[:80] + ("…" if len(compact) > 80 else "")


def complete_compound_proposals(question: str, proposals: list[dict[str, Any]], figures: dict[str, Any]) -> list[dict[str, Any]]:
    required = required_proposal_kinds(question)
    if required == {"arrange_elements"}:
        return [item for item in proposals if item.get("kind") == "arrange_elements"] or [{"kind": "arrange_elements", "strategy": "thematic"}]
    created = next((item for item in proposals if item.get("kind") == "create_element"), None)
    if "create_relationship" in required and created and not any(item.get("kind") == "create_relationship" for item in proposals):
        folded = question.casefold()
        matches = [node for node in figures.get("nodes") or [] if str(node.get("name", "")).casefold() in folded]
        if matches:
            labels = {"sohn": "Sohn von", "tochter": "Tochter von", "vater": "Vater von", "mutter": "Mutter von", "bruder": "Bruder von", "schwester": "Schwester von", "ehefrau": "Ehefrau von", "ehemann": "Ehemann von", "partner": "Partner von", "partnerin": "Partnerin von"}
            key = next((key for key in labels if key in folded), None)
            ownership = key is None and (re.search(r"\bhat\s+(?:einen?|eine)\b", folded) or "besitzt" in folded or "gehört" in folded)
            relationship = ({"from": matches[0]["id"], "to": created["tempId"], "label": "Besitzt", "directed": True, "style": "solid"}
                            if ownership else {"from": created["tempId"], "to": matches[0]["id"], "label": labels.get(key or "", "Verwandt mit"), "directed": True, "style": "solid"})
            proposals.append({"kind": "create_relationship", "relationship": relationship})
    return proposals
