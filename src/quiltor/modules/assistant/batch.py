"""Batch-mode orchestration: grouping chapters into token-budgeted calls, folding
earlier groups' proposals into a figures-shaped view for cross-group dedup, and the
rough time estimate shown before a user opts into batch mode."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from quiltor.modules.assistant.ports import AssistantProgressStore
from quiltor.modules.assistant.prompts import DEFAULT_ASSISTANT_LANGUAGE, UNTITLED_CHAPTER

# Per-group ceiling for batch mode's chapter grouping. Chapters vary a lot in length (a
# confirmed 277-4679 words across one test manuscript), so groups are built by walking
# chapters and accumulating real token counts up to this ceiling, not a flat chapter count
# -- a fixed "N chapters per call" would just be a smaller version of the same fragile
# constant this whole feature exists to get away from.
BATCH_GROUP_TOKEN_BUDGET = 3500


def estimate_batch_seconds(chapter_count: int, factor: float = 1.0) -> float:
    """Rough estimate only, deliberately conservative and presented as a range, not a
    false-precision number: group_count * (a typical group's max_tokens / a slow-end
    tokens-per-second figure observed for this model on this machine)."""
    if chapter_count <= 0:
        return 0.0
    group_count = max(1, round(chapter_count * 1400 / BATCH_GROUP_TOKEN_BUDGET))
    seconds_per_group = 1200 / 9  # a compound-request-sized max_tokens budget / slow-end tok/s
    return group_count * seconds_per_group * factor


def _format_minutes(seconds: float) -> str:
    return str(max(1, round(seconds / 60)))


def broad_scope_message(chapter_count: int) -> str:
    low, high = (
        estimate_batch_seconds(chapter_count, 0.7),
        estimate_batch_seconds(chapter_count, 1.3),
    )
    return (
        f"Das betrifft alle {chapter_count} Kapitel. Eine einzelne Anfrage bekäme dafür entweder "
        f"nicht genug Kontext oder nicht genug Antwortraum. Ich kann stattdessen kapitelweise "
        f"in Gruppen durchgehen, lokal geschätzt "
        f"{_format_minutes(low)}-{_format_minutes(high)} Minuten. Wähle einzelne Kapitel aus, "
        f"oder lass mich in Gruppen durchgehen."
    )


def broad_scope_reply(chapter_count: int) -> dict[str, Any]:
    """Same content as broad_scope_message(), plus the messageKey/messageParams the frontend
    needs to render it in the interface language -- see locales/{de,en}/assistant.ts's
    broadScopeMessage key."""
    low, high = (
        estimate_batch_seconds(chapter_count, 0.7),
        estimate_batch_seconds(chapter_count, 1.3),
    )
    return {
        "message": broad_scope_message(chapter_count),
        "messageKey": "broadScopeMessage",
        "messageParams": {
            "chapterCount": chapter_count,
            "minMinutes": _format_minutes(low),
            "maxMinutes": _format_minutes(high),
        },
    }


def batch_summary_reply(
    chapter_count: int, group_count: int, proposal_count: int
) -> dict[str, Any]:
    """Same content the batch summary previously hardcoded inline, plus the messageKey the
    frontend needs -- see locales/{de,en}/assistant.ts's batchSummary key."""
    return {
        "message": (
            f"{chapter_count} Kapitel in {group_count} Gruppen verarbeitet, {proposal_count} Vorschläge vorbereitet. "
            "Jeder Vorschlag kann einzeln geprüft und übernommen werden."
        ),
        "messageKey": "batchSummary",
        "messageParams": {
            "chapters": chapter_count,
            "groups": group_count,
            "proposals": proposal_count,
        },
    }


def _group_chapters_by_budget(
    chapters: list[dict[str, Any]],
    identity: str,
    budget: int,
    count_tokens: Callable[[str], int],
) -> list[list[str]]:
    """Group chapter IDs so each group's combined chapter text stays within budget tokens,
    instead of a flat chapter count -- chapter length varies a lot (a confirmed
    277-4679 words across one test manuscript), so a fixed "N chapters per call" would
    just reintroduce the same fixed-constant fragility batch mode exists to get away from."""
    groups: list[list[str]] = []
    current: list[str] = []
    used = 0
    for chapter in chapters:
        tokens = count_tokens(str(chapter.get("body") or ""))
        if current and used + tokens > budget:
            groups.append(current)
            current, used = [], 0
        current.append(chapter["id"])
        used += tokens
    if current:
        groups.append(current)
    return groups


def _merge_accumulated(
    figures: dict[str, Any], accumulated: list[dict[str, Any]]
) -> dict[str, Any]:
    """Fold earlier batch proposals into the next group's resolver snapshot.

    Creates use their temp IDs as canonical staged IDs; element updates and presence
    changes are applied to the copied snapshot. A later group therefore sees the full
    proposed state and cannot emit the same logical operation again.
    """
    nodes, edges, timeline, presence = (
        [dict(item) for item in figures.get("nodes") or []],
        [dict(item) for item in figures.get("edges") or []],
        [dict(item) for item in figures.get("timeline") or []],
        [dict(item) for item in figures.get("presence") or []],
    )
    for proposal in accumulated:
        kind = proposal.get("kind")
        if kind == "create_element":
            nodes.append({**(proposal.get("element") or {}), "id": proposal.get("tempId")})
        elif kind == "update_element":
            identifier = proposal.get("elementId")
            patch = proposal.get("patch") or {}
            nodes = [{**node, **patch} if node.get("id") == identifier else node for node in nodes]
        elif kind == "create_relationship":
            relation = proposal.get("relationship") or {}
            edges.append(
                {
                    "id": f"temp:edge:{len(edges)}",
                    "from": relation.get("from"),
                    "to": relation.get("to"),
                    "gerichtet": relation.get("directed"),
                    "label": relation.get("label"),
                }
            )
        elif kind == "create_timeline_moment":
            timeline.append({**(proposal.get("moment") or {}), "id": proposal.get("tempId")})
        elif kind == "set_presence":
            canonical = {
                key: proposal[key]
                for key in ("elementId", "placeId", "momentId")
                if key in proposal
            }
            identity = (canonical.get("elementId"), canonical.get("momentId"))
            matching = next(
                (
                    index
                    for index, item in enumerate(presence)
                    if (item.get("elementId"), item.get("momentId")) == identity
                ),
                None,
            )
            if matching is None:
                presence.append({"id": f"temp:presence:{len(presence)}", **canonical})
            else:
                presence[matching] = {**presence[matching], **canonical}
    return {
        **figures,
        "nodes": nodes,
        "edges": edges,
        "timeline": timeline,
        "presence": presence,
    }


def run_batches(
    question: str,
    manuscript: dict[str, Any],
    figures: dict[str, Any],
    history: list[dict[str, Any]] | None,
    progress_id: str | None,
    language: str = DEFAULT_ASSISTANT_LANGUAGE,
    owner_sub: str = "",
    world_id: str = "",
    world_revision: int = 0,
    chapter_ids: list[str] | None = None,
    mode: str = "chat",
    *,
    complete: Callable[..., dict[str, Any]],
    progress: AssistantProgressStore,
    identity: str,
    count_tokens: Callable[[str], int],
) -> dict[str, Any]:
    """Run an explicitly approved broad request through token-budgeted groups.

    Runtime-owned collaborators are supplied as ports/callables, keeping the product
    batching policy independent from process lifecycle and inference infrastructure.
    """
    selected = set(chapter_ids or [])
    chapters = [
        chapter
        for chapter in manuscript.get("chapters") or []
        if not selected or chapter.get("id") in selected
    ]
    groups = _group_chapters_by_budget(
        chapters,
        identity,
        BATCH_GROUP_TOKEN_BUDGET,
        count_tokens,
    )
    untitled = UNTITLED_CHAPTER.get(language, UNTITLED_CHAPTER[DEFAULT_ASSISTANT_LANGUAGE])
    titles = {chapter["id"]: chapter.get("title") or untitled for chapter in chapters}
    trace: list[dict[str, Any]] = [
        {"step": "batch_start", "groups": len(groups), "chapters": len(chapters)}
    ]
    accumulated: list[dict[str, Any]] = []
    notes: list[str] = []
    citations: list[str] = []
    sources: list[dict[str, Any]] = []
    envelopes: list[dict[str, Any]] = []
    clarification_candidates: list[dict[str, Any]] = []
    if progress_id:
        progress.start(owner_sub, world_id, progress_id, len(groups))
    try:
        for index, group in enumerate(groups, start=1):
            label_params = {
                "index": index,
                "total": len(groups),
                "titles": ", ".join(titles[cid] for cid in group),
            }
            label = f"Kapitel {index}/{len(groups)}: " + label_params["titles"]
            merged_figures = _merge_accumulated(figures, accumulated)
            result = complete(
                question,
                manuscript,
                merged_figures,
                history,
                chapter_ids=group,
                language=language,
                owner_sub=owner_sub,
                world_id=world_id,
                world_revision=world_revision,
                mode=mode,
            )
            if result.get("clarification"):
                known_ids = {str(item.get("id")) for item in clarification_candidates}
                clarification_candidates.extend(
                    dict(item)
                    for item in result["clarification"].get("candidates") or []
                    if isinstance(item, dict) and str(item.get("id")) not in known_ids
                )
                if result.get("message"):
                    notes.append(f"{label}: {result['message']}")
                trace.extend(
                    [
                        {
                            "step": "batch_group",
                            "index": index,
                            "chapterIds": group,
                            "proposalKinds": [],
                            "needsClarification": True,
                        },
                        *(result.get("agentTrace") or []),
                    ]
                )
                if progress_id:
                    progress.update(
                        owner_sub,
                        world_id,
                        progress_id,
                        index,
                        "chapterGroupLabel",
                        label_params,
                    )
                continue
            proposals = result.get("proposals") or []
            result_sources = [
                dict(item) for item in result.get("sources") or [] if isinstance(item, dict)
            ]
            source_ids = {str(item.get("id")) for item in sources}
            sources.extend(item for item in result_sources if str(item.get("id")) not in source_ids)
            citations.extend(
                str(item) for item in result.get("citations") or [] if str(item) not in citations
            )
            result_envelopes = result.get("proposalEnvelopes") or []
            if isinstance(result_envelopes, list) and len(result_envelopes) == len(proposals):
                envelopes.extend(dict(item) for item in result_envelopes if isinstance(item, dict))
            else:
                envelopes.extend(
                    {
                        "proposal": proposal,
                        "evidence": result_sources,
                        **({"claimStatus": "unresolved"} if mode == "world_extraction" else {}),
                    }
                    for proposal in proposals
                )
            accumulated.extend(proposals)
            if result.get("message"):
                notes.append(f"{label}: {result['message']}")
            trace.append(
                {
                    "step": "batch_group",
                    "index": index,
                    "chapterIds": group,
                    "proposalKinds": [item.get("kind") for item in proposals],
                }
            )
            if progress_id:
                progress.update(
                    owner_sub,
                    world_id,
                    progress_id,
                    index,
                    "chapterGroupLabel",
                    label_params,
                )
    finally:
        if progress_id:
            progress.finish(owner_sub, world_id, progress_id)
    group_order = ("elements", "updates", "relationships", "timeline", "presence")
    group_for_kind = {
        "create_element": "elements",
        "update_element": "updates",
        "create_relationship": "relationships",
        "set_relationship_at_moment": "relationships",
        "create_timeline_moment": "timeline",
        "mark_deceased": "timeline",
        "set_presence": "presence",
    }
    proposal_groups = [
        {
            "id": group,
            "proposalIndexes": [
                index
                for index, proposal in enumerate(accumulated)
                if group_for_kind.get(str(proposal.get("kind"))) == group
            ],
        }
        for group in group_order
    ]
    proposal_groups = [group for group in proposal_groups if group["proposalIndexes"]]
    summary = batch_summary_reply(len(chapters), len(groups), len(accumulated))
    if mode == "world_extraction" and not accumulated:
        summary = {
            "message": "In der gewählten Kapitelauswahl wurde kein neuer prüfbarer Weltzustand gefunden.",
            "messageKey": "extractionEmpty",
        }
    return {
        **summary,
        "citations": citations,
        "sources": sources,
        "proposals": accumulated,
        "proposalEnvelopes": envelopes,
        "proposalGroups": proposal_groups,
        **(
            {"clarification": {"candidates": clarification_candidates}}
            if clarification_candidates
            else {}
        ),
        "mode": mode,
        "extraction": {
            "chapterIds": [str(chapter.get("id")) for chapter in chapters],
            "chapterCount": len(chapters),
            "groupCount": len(groups),
        }
        if mode == "world_extraction"
        else None,
        "agentTrace": trace,
        "batchNotes": notes,
    }
