"""Batch-mode orchestration: grouping chapters into token-budgeted calls, folding
earlier groups' proposals into a figures-shaped view for cross-group dedup, and the
rough time estimate shown before a user opts into batch mode."""

from __future__ import annotations

from typing import Any, Callable

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
    """Fold earlier batch groups' create_* proposals into a figures-shaped view so
    validate_proposals's existing dedup logic (existing_names, the duplicate-edge check,
    existing_moments -- all of which read from the `figures` argument) also rejects
    repeats across batch groups, for free: no separate cross-batch dedup logic to write
    or maintain, just a shape translation. Synthesized nodes/moments use their tempId as
    `id`, so a later group's relationship proposal referencing an earlier group's
    newly-created element resolves through the ordinary known_elements check too."""
    nodes, edges, timeline = (
        list(figures.get("nodes") or []),
        list(figures.get("edges") or []),
        list(figures.get("timeline") or []),
    )
    for proposal in accumulated:
        kind = proposal.get("kind")
        if kind == "create_element":
            nodes.append({**(proposal.get("element") or {}), "id": proposal.get("tempId")})
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
    return {**figures, "nodes": nodes, "edges": edges, "timeline": timeline}


def run_batches(
    question: str,
    manuscript: dict[str, Any],
    figures: dict[str, Any],
    history: list[dict[str, Any]] | None,
    progress_id: str | None,
    language: str = DEFAULT_ASSISTANT_LANGUAGE,
    owner_sub: str = "",
    world_id: str = "",
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
    chapters = manuscript.get("chapters") or []
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
            )
            proposals = result.get("proposals") or []
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
    return {
        **batch_summary_reply(len(chapters), len(groups), len(accumulated)),
        "citations": [],
        "sources": [],
        "proposals": accumulated,
        "agentTrace": trace,
        "batchNotes": notes,
    }
