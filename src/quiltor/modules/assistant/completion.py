"""The RAG, contract, proposal, verification, and response completion pipeline."""

from __future__ import annotations

import json
import re
import time
from typing import Any, Protocol

from quiltor.domain.story_world.knowledge import build_knowledge, retrieve
from quiltor.modules.assistant.audit import audit_reply, validate_proposals, validate_world
from quiltor.modules.assistant.batch import broad_scope_reply, estimate_batch_seconds
from quiltor.modules.assistant.config import RUNTIME_CONFIG
from quiltor.modules.assistant.context import pack_chunks
from quiltor.modules.assistant.contract import (
    complete_compound_proposals,
    creation_target_resolution,
    existing_creation_target,
    proposal_group_title,
    structured_world_state,
    task_contract,
    verify_task_contract,
)
from quiltor.modules.assistant.conversation import conversation_messages, fit_to_budget
from quiltor.modules.assistant.entity_references import clarification_candidates
from quiltor.modules.assistant.planner import needs_planner
from quiltor.modules.assistant.ports import InferenceEngine, TokenCountCache
from quiltor.modules.assistant.prompts import (
    CONTEXT_SAFETY_MARGIN,
    DEFAULT_ASSISTANT_LANGUAGE,
    MODEL_CONTEXT_TOKENS,
    MUTATION_REQUEST,
    PROSE_REQUEST,
    system_prompt,
)
from quiltor.modules.assistant.proposals import missing_items, set_deterministic_message
from quiltor.modules.assistant.references import resolve_reference
from quiltor.modules.assistant.schemas import KINDS, json_schema_format, reply_schema


class CompletionRuntime(Protocol):
    """Runtime capabilities consumed by the pure product completion pipeline."""

    url: str
    inference: InferenceEngine
    token_cache: TokenCountCache
    debug_enabled: bool
    _invocation_metrics: list[dict[str, Any]]

    def _invoke_with_growth(
        self, payload: dict[str, Any], prompt_tokens: int
    ) -> dict[str, Any]: ...

    def _plan(self, question: str, context: list[Any]) -> dict[str, Any]: ...

    def _forced_proposal(
        self, question: str, context_json: str, figures: dict[str, Any]
    ) -> dict[str, Any] | None: ...

    def _run_batches(
        self,
        question: str,
        manuscript: dict[str, Any],
        figures: dict[str, Any],
        history: list[dict[str, Any]] | None,
        progress_id: str | None,
        language: str,
        owner_sub: str,
        world_id: str,
    ) -> dict[str, Any]: ...


def complete_request(
    runtime: CompletionRuntime,
    question: str,
    manuscript: dict[str, Any],
    figures: dict[str, Any],
    history: list[dict[str, Any]] | None = None,
    chapter_ids: list[str] | None = None,
    run_batches: bool = False,
    progress_id: str | None = None,
    language: str = DEFAULT_ASSISTANT_LANGUAGE,
    *,
    owner_sub: str = "",
    world_id: str = "",
) -> dict[str, Any]:
    started_at = time.monotonic()
    runtime._invocation_metrics = []
    prompt = system_prompt(language)
    chunks = build_knowledge(manuscript, figures)
    contract = task_contract(question, figures)
    reference = resolve_reference(question, history, figures)
    if reference and reference.get("clarification"):
        clarification = reference["clarification"]
        return {
            "message": "Welches Element meinst du?",
            "messageKey": "whichElementDoYouMean",
            "citations": [],
            "sources": [],
            "proposals": [],
            "clarification": clarification,
            "agentTrace": [
                {"step": "clarification", "candidateCount": len(clarification["candidates"])}
            ],
        }
    if reference and reference.get("resolvedId"):
        question = f"{question}\n[Resolved reference: {reference['resolvedId']}]"
    context = retrieve(chunks, question)
    trace: list[dict[str, Any]] = [
        {"step": "initial_search", "query": question, "sources": [item.id for item in context]}
    ]
    trace.append({"step": "contract", **contract})
    forced = [
        chunk
        for chunk in chunks
        if chapter_ids
        and chunk.kind in {"chapter", "chapter-note"}
        and chunk.target.get("id") in set(chapter_ids)
    ]
    if forced:
        forced_by_id = {chunk.id: chunk for chunk in forced}
        ranked_ids = [chunk.id for chunk in context if chunk.id in forced_by_id]
        forced = [forced_by_id[item] for item in ranked_ids] + [
            chunk for chunk in forced if chunk.id not in set(ranked_ids)
        ]
        forced = fit_to_budget(
            forced,
            runtime.url,
            MODEL_CONTEXT_TOKENS - CONTEXT_SAFETY_MARGIN,
            trace,
            runtime.inference.count_tokens,
            runtime.token_cache,
        )
        trace.append(
            {
                "step": "force_context",
                "chapterIds": chapter_ids,
                "sources": [item.id for item in forced],
            }
        )
    if contract["audit"]:
        audit = validate_world(figures)
        evidence = [chunk.public() for chunk in chunks if chunk.kind == "relationship"][:12]
        trace.append(
            {
                "step": "verify",
                "complete": True,
                "missing": [],
                "issues": audit["issues"],
                "inspected": audit["inspected"],
            }
        )
        return {
            **audit_reply(audit, contract),
            "citations": [item["id"] for item in evidence],
            "sources": evidence,
            "proposals": [],
            "agentTrace": trace,
        }
    creation_resolution = creation_target_resolution(question, figures, contract)
    if creation_resolution is not None and creation_resolution.status == "ambiguous":
        candidates = clarification_candidates(
            figures, (item.element_id for item in creation_resolution.candidates)
        )
        if candidates:
            trace.append(
                {
                    "step": "preflight",
                    "complete": False,
                    "reason": "ambiguous element",
                    "candidateCount": len(candidates),
                }
            )
            return {
                "message": "Welches Element meinst du?",
                "messageKey": "whichElementDoYouMean",
                "citations": [],
                "sources": [],
                "proposals": [],
                "clarification": {"candidates": candidates},
                "agentTrace": trace,
            }
    duplicate = existing_creation_target(question, figures, contract)
    if duplicate:
        source_id = f"element:{duplicate['id']}"
        source = next((chunk.public() for chunk in chunks if chunk.id == source_id), None)
        trace.append(
            {
                "step": "preflight",
                "complete": False,
                "reason": "existing element",
                "elementId": duplicate["id"],
            }
        )
        duplicate_name = duplicate.get("name", "Dieses Element")
        return {
            "message": f"„{duplicate_name}“ existiert bereits. Deshalb habe ich kein doppeltes Element vorgeschlagen. Du kannst stattdessen den vorhandenen Steckbrief oder seine Beziehungen ergänzen.",
            "messageKey": "duplicateElementExists",
            "messageParams": {"name": duplicate_name},
            "citations": [source_id],
            "sources": [source] if source else [],
            "proposals": [],
            "agentTrace": trace,
        }
    if contract["broad"] and not chapter_ids and not run_batches:
        chapter_count = len({chapter["id"] for chapter in manuscript.get("chapters") or []})
        trace.append(
            {
                "step": "preflight",
                "complete": False,
                "reason": "broad scope",
                "chapterCount": chapter_count,
            }
        )
        return {
            **broad_scope_reply(chapter_count),
            "citations": [],
            "sources": [],
            "proposals": [],
            "agentTrace": trace,
            "broadScope": {
                "chapterCount": chapter_count,
                "estimateSeconds": estimate_batch_seconds(chapter_count),
            },
        }
    if run_batches and not chapter_ids:
        return runtime._run_batches(
            question,
            manuscript,
            figures,
            history,
            progress_id,
            language,
            owner_sub,
            world_id,
        )
    plan = (
        {
            "goal": question,
            "steps": contract["expected"],
            "searchQueries": [],
            "requiredKinds": contract["requiredKinds"],
            "planner": "deterministic",
        }
        if contract["requiredKinds"] or not needs_planner(question)
        else runtime._plan(question, context)
    )
    plan.setdefault("planner", "model")
    trace.append({"step": "plan", **plan})
    known_context = {item.id: item for item in context}
    for query in plan.get("searchQueries", [])[:4]:
        found = retrieve(chunks, str(query))
        trace.append(
            {"step": "search_world", "query": query, "sources": [item.id for item in found]}
        )
        known_context.update((item.id, item) for item in found)
    limit = 10 if contract["requiredKinds"] else 16
    rest = [
        item for item in known_context.values() if item.id not in {chunk.id for chunk in forced}
    ]
    context_candidates = forced + rest[: max(0, limit - len(forced))]
    counter = lambda _identity, text: runtime.inference.count_tokens(text)
    context = pack_chunks(
        context_candidates,
        runtime.url,
        RUNTIME_CONFIG.forced_context_tokens,
        counter,
        runtime.token_cache,
        trace,
    )
    context_json = json.dumps([chunk.public() for chunk in context], ensure_ascii=False)
    world_json = json.dumps(structured_world_state(figures, contract), ensure_ascii=False)
    if PROSE_REQUEST.search(question):
        return {
            "message": "Ich schreibe oder vervollständige keine Romanprosa. Ich kann die geplante Szene aber anhand deiner Welt analysieren, Widersprüche finden, beteiligte Figuren und Beziehungen ordnen oder ihre Konsequenzen als Notizen vorbereiten.",
            "messageKey": "proseRefusal",
            "citations": [],
            "sources": [],
            "proposals": [],
        }
    mutation_requested = bool(MUTATION_REQUEST.search(question))
    schema = reply_schema(contract["requiredKinds"] or (KINDS if mutation_requested else []))
    conversation = conversation_messages(
        history, runtime.url, runtime.inference.count_tokens, runtime.token_cache
    )

    def prompt_for(packed_json: str) -> tuple[str, int, int]:
        content = f"STRUCTURED WORLD STATE (complete for the requested scopes):\n{world_json}\n\nRAG CONTEXT (content excerpts only):\n{packed_json}\n\nTASK CONTRACT:\n{json.dumps(contract, ensure_ascii=False)}\n\nREQUEST:\n{question}\n/no_think"
        tokens = runtime.inference.count_tokens(
            prompt + "".join(message["content"] for message in conversation) + content
        )
        return content, tokens, MODEL_CONTEXT_TOKENS - tokens - RUNTIME_CONFIG.template_reserve

    user_content, prompt_tokens, headroom = prompt_for(context_json)
    for reduced_budget in (4096, 3072, 2048, 1024, 512, 0):
        if headroom >= RUNTIME_CONFIG.minimum_output_tokens:
            break
        context = pack_chunks(
            context_candidates,
            runtime.url,
            reduced_budget,
            counter,
            runtime.token_cache,
        )
        context_json = json.dumps([chunk.public() for chunk in context], ensure_ascii=False)
        user_content, prompt_tokens, headroom = prompt_for(context_json)
        trace.append(
            {
                "step": "context_reduce",
                "tokenBudget": reduced_budget,
                "promptTokens": prompt_tokens,
                "remainingOutputTokens": headroom,
            }
        )
    if headroom < RUNTIME_CONFIG.minimum_output_tokens:
        raise RuntimeError(
            "Die Anfrage ist zu umfangreich für das Kontextfenster des lokalen Modells "
            "(bereits der Prompt allein überschreitet das Limit). Bitte die Anfrage eingrenzen, "
            "z. B. auf weniger Kapitel."
        )
    max_tokens = min(
        RUNTIME_CONFIG.base_output_tokens
        + RUNTIME_CONFIG.output_tokens_per_kind * len(contract["requiredKinds"]),
        headroom,
    )
    payload = {
        "model": "local",
        "stream": False,
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": prompt},
            *conversation,
            {"role": "user", "content": user_content},
        ],
        "response_format": json_schema_format(schema),
    }
    supported = set(KINDS)
    explicit_required = set(contract["requiredKinds"])
    planned_required = {kind for kind in plan.get("requiredKinds", []) if kind in supported}
    required = explicit_required or (planned_required if mutation_requested else set())
    if required:
        payload["messages"][1]["content"] += (
            "\n\nTASK REQUIREMENTS: The structured proposals must include: "
            + ", ".join(sorted(required))
            + "."
        )
    parsed = runtime._invoke_with_growth(payload, prompt_tokens)
    raw_proposals = parsed.get("proposals") if isinstance(parsed.get("proposals"), list) else []
    parsed["proposals"] = validate_proposals(raw_proposals, figures, question)
    discarded_proposals = max(0, len(raw_proposals) - len(parsed["proposals"]))
    if not mutation_requested:
        parsed["proposals"] = []
    parsed["proposals"] = complete_compound_proposals(question, parsed["proposals"], figures)
    trace.append(
        {"step": "propose", "proposalKinds": [item.get("kind") for item in parsed["proposals"]]}
    )
    if required - {item.get("kind") for item in parsed["proposals"]}:
        deterministic = runtime._forced_proposal(question, context_json, figures)
        deterministic_proposals = validate_proposals(
            [deterministic] if deterministic else [], figures, question
        )
        if deterministic_proposals:
            parsed["proposals"] = complete_compound_proposals(
                question, deterministic_proposals, figures
            )
            trace.append(
                {
                    "step": "deterministic_fallback",
                    "proposalKinds": [item.get("kind") for item in parsed["proposals"]],
                }
            )
        else:
            retry_schema = json.loads(json.dumps(schema))
            retry_schema["properties"]["proposals"]["minItems"] = 1
            repair_note = "The response was semantically incomplete: a required world-data proposal was missing or invalid. Correct it using IDs from CONTEXT. Do not claim it was applied. /no_think"
            retry = {
                **payload,
                "response_format": json_schema_format(retry_schema),
                "messages": [
                    *payload["messages"],
                    {"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)},
                    {"role": "user", "content": repair_note},
                ],
            }
            retry_prompt_tokens = prompt_tokens + runtime.inference.count_tokens(
                json.dumps(parsed, ensure_ascii=False) + repair_note
            )
            parsed = runtime._invoke_with_growth(retry, retry_prompt_tokens)
            parsed["proposals"] = validate_proposals(parsed.get("proposals"), figures, question)
            if not mutation_requested:
                parsed["proposals"] = []
            parsed["proposals"] = complete_compound_proposals(
                question, parsed["proposals"], figures
            )
            trace.append(
                {
                    "step": "repair",
                    "proposalKinds": [item.get("kind") for item in parsed["proposals"]],
                }
            )
    if MUTATION_REQUEST.search(question) and not parsed["proposals"]:
        forced = runtime._forced_proposal(question, context_json, figures)
        if runtime.debug_enabled:
            print(f"  · AI forced proposal: {json.dumps(forced, ensure_ascii=False)}", flush=True)
        parsed["proposals"] = validate_proposals([forced] if forced else [], figures, question)
        if parsed["proposals"] and not parsed.get("message"):
            parsed["message"] = (
                "Ich habe die gewünschte Änderung als prüfbaren Vorschlag vorbereitet."
            )
            set_deterministic_message(parsed, "proposalPreparedGeneric")
    verification = verify_task_contract(contract, parsed["proposals"], figures)
    if parsed["proposals"]:
        parsed["message"] = re.sub(
            r"\b(?:wurde|wird|ist)(?: als [^.!\n]+)? (?:hinzugefügt|angelegt|erstellt|aufgenommen)\b",
            "ist als Vorschlag vorbereitet",
            str(parsed.get("message", "")),
            flags=re.IGNORECASE,
        )
        parsed["message"] = re.sub(
            r"\b(hinzugefügt|angelegt|erstellt|aufgenommen)\b",
            "als Vorschlag vorbereitet",
            parsed["message"],
            flags=re.IGNORECASE,
        )
    known = {chunk.id: chunk.public() for chunk in context}
    raw_citations = parsed.get("citations") if isinstance(parsed.get("citations"), list) else []
    parsed["citations"] = list(dict.fromkeys(source for source in raw_citations if source in known))
    discarded_citations = len(raw_citations) - len(parsed["citations"])
    parsed["sources"] = [known[source] for source in parsed["citations"]]
    if discarded_proposals or discarded_citations:
        trace.append(
            {
                "step": "discard",
                "proposalReasons": {"semantic_validation": discarded_proposals},
                "citationReasons": {"unknown_or_duplicate": discarded_citations},
            }
        )
    if (
        not parsed["proposals"]
        and not parsed["citations"]
        and any(chunk.kind in {"chapter", "chapter-note"} for chunk in context)
        and not PROSE_REQUEST.search(question)
    ):
        parsed["message"] = (
            str(parsed.get("message", "")).rstrip()
            + "\n\nHinweis: Diese manuskriptbezogene Aussage ist ohne gültige Quellenangabe unbelegt."
        )
        parsed["messageNoteKey"] = "unsourcedManuscriptNote"
    if contract["audit"]:
        audit = validate_world(figures)
        parsed.update(audit_reply(audit, contract))
        parsed["proposals"] = []
        parsed["citations"] = [chunk.id for chunk in context if chunk.kind == "relationship"][:12]
        parsed["sources"] = [known[source] for source in parsed["citations"] if source in known]
        verification = {
            "complete": True,
            "missing": [],
            "issues": audit["issues"],
            "inspected": audit["inspected"],
        }
    elif not verification["complete"]:
        parsed["message"] = (
            "Ich konnte die Aufgabe noch nicht vollständig als sicheren Vorschlag vorbereiten. Es fehlen: "
            + ", ".join(verification["missing"])
            + ". Es wurde nichts angewendet."
        )
        set_deterministic_message(
            parsed, "taskIncompleteMissing", items=missing_items(verification["missing"])
        )
    elif parsed["proposals"]:
        parsed["proposalGroup"] = {
            "id": "task",
            "title": proposal_group_title(question),
            "proposalIndexes": list(range(len(parsed["proposals"]))),
        }
        proposal_count = len(parsed["proposals"])
        parsed["message"] = (
            f"{proposal_count} zusammengehörige Änderung{'en' if proposal_count != 1 else ''} als prüfbarer Vorschlag vorbereitet. Es wurde noch nichts angewendet."
        )
        set_deterministic_message(
            parsed,
            "proposalsPreparedOne" if proposal_count == 1 else "proposalsPreparedMany",
            params={"n": proposal_count},
        )
    trace.append({"step": "verify", **verification})
    calls = list(getattr(runtime, "_invocation_metrics", []))
    trace.append(
        {
            "step": "metrics",
            "plannerCalls": int(
                any(
                    item.get("step") == "plan" and item.get("planner") != "deterministic"
                    for item in trace
                )
            ),
            "answerCalls": 1,
            "repairCalls": int(any(item.get("step") == "repair" for item in trace)),
            "promptTokens": prompt_tokens,
            "usedContextTokens": prompt_tokens,
            "contextTokens": MODEL_CONTEXT_TOKENS,
            "outputBudget": max_tokens,
            "durationMs": round((time.monotonic() - started_at) * 1000),
            "finishReason": calls[-1].get("finishReason", "unknown") if calls else "unknown",
            "runtimeCalls": calls,
            "tokenCache": runtime.token_cache.stats(),
            "discardedProposals": discarded_proposals,
            "discardedCitations": discarded_citations,
        }
    )
    parsed["agentTrace"] = trace
    return parsed
