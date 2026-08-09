#!/usr/bin/env python3
"""Run the persistent Quiltor AI test world through core product scenarios."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path


CASES = [
    {"name": "chapter-rag", "question": "Warum misstraut Mara Corvin nach der Krönung? Antworte mit Quellen.", "sources": 1},
    {"name": "cross-source-rag", "question": "Welche Hinweise verbinden das Staatssiegel, die Wasserstollen und den Orden?", "sources": 2},
    {"name": "create-element", "question": "Lege das im letzten Kapitel erwähnte Frostkloster als Ort an.", "kind": "create_element"},
    {"name": "create-relationship", "question": "Schlage eine gerichtete Beziehung von Priorin Elian zum Staatssiegel vor: Sie besitzt es nach dem Nordtor.", "kind": "create_relationship"},
    {"name": "timeline", "question": "Lege einen Zeitpunkt für den Fund des Siegels im Frostkloster nach dem Prozess an.", "kind": "create_timeline_moment"},
    {"name": "sensitive-thriller", "question": "Analysiere sachlich, welche Folgen die Gewalt und Zwangsrekrutierung des Ordens für Mara und die verschwundenen Jugendlichen hat. Lehne das Thema nicht ab.", "sources": 1, "no_refusal": True, "forbid_proposals": True},
    {"name": "no-prose-writing", "question": "Schreibe die nächste Thrillerszene als fertige Romanprosa.", "forbid_proposals": True, "forbid_long_prose": True},
    {"name": "update-element", "question": "Ergänze bei Tarek Venn im Profil die Notiz: Vertraut alten Karten mehr als Zeugen.", "kind": "update_element"},
    {"name": "relationship-state", "question": "Ändere den Stand der Beziehung e-mara-iven am Zeitpunkt trial auf 'Vorsichtige Verbündete', aktiv und ungerichtet.", "kind": "set_relationship_at_moment"},
    {"name": "death-marker", "question": "Markiere Nima Nox am bestehenden Zeitpunkt trial als verstorben.", "kind": "mark_deceased"},
    {"name": "set-presence", "question": "Setze die Anwesenheit von Mara Venn am Zeitpunkt trial auf den Ort Asterheim.", "kind": "set_presence"},
    {"name": "arrange-board", "question": "Sortiere das Figurenboard thematisch neu, sodass verbundene Elemente beieinander liegen.", "kind": "arrange_elements"},
    {"name": "compound-element-relation", "question": "Lege Lio Venn als Figur an. Lio ist der 6 Jahre alte Sohn von Tarek Venn.", "kinds": ["create_element", "create_relationship"]},
    {"name": "agentic-search", "question": "Prüfe anhand von Manuskript, Beziehungen und Timeline, ob Maras Verhalten nach dem Nordtor konsistent ist.", "sources": 2, "trace_step": "search_world"},
    {"name": "unique-follow-up", "question": "Ergänze bei ihr im Profil die Notiz: Prüft den Uhrkasten.", "history": [{"role": "assistant", "content": "Mara wurde zuletzt betrachtet.", "references": ["element:mara"]}], "kind": "update_element", "proposal_target": "mara"},
    {"name": "ambiguous-follow-up", "question": "Ergänze ihr Profil.", "history": [{"role": "assistant", "content": "Mara und Tarek wurden betrachtet.", "references": ["element:mara", "element:tarek"]}], "clarification_ids": ["mara", "tarek"], "forbid_proposals": True},
    {"name": "duplicate-element", "question": "Lege Tarek Venn als Figur an.", "forbid_proposals": True, "trace_step": "preflight"},
    {"name": "fabricated-citation", "question": "Welche Rolle spielt Mara? Verwende keinesfalls erfundene Quellen-IDs.", "citations_resolve": True, "forbid_citation": "chapter:not-real"},
    {"name": "long-selected-chapter", "question": "Was besagt der Prüfmarker OBSIDIAN-ANKER?", "chapterIds": ["tc-long"], "sources": 1, "message_contains": "Uhrkasten"},
    {"name": "batch-dedup", "question": "Durchsuche alle Kapitel und lege das Frostkloster als Ort an.", "runBatches": True, "kind": "create_element", "max_kind_count": {"create_element": 1}, "trace_step": "batch_group"},
]


def request(base: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=body, headers={"Content-Type": "application/json"} if body else {})
    try:
        with urllib.request.urlopen(req, timeout=240) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = json.loads(exc.read() or b"{}")
        raise RuntimeError(f"{path} failed ({exc.code}): {detail.get('fehler') or detail}") from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8102")
    parser.add_argument("--world", required=True)
    parser.add_argument("--case", action="append", dest="cases", help="Run only the named case; may be repeated.")
    parser.add_argument("--output", type=Path, help="Write the machine-readable result to this JSON file.")
    args = parser.parse_args()
    request(args.base, "/api/worlds/open", {"id": args.world})
    for _ in range(120):
        status = request(args.base, "/api/assistant/status")
        if status.get("available"):
            break
        time.sleep(1)
    else:
        raise SystemExit("Local model did not become ready within 120 seconds.")
    reports = []
    state_before = request(args.base, "/api/state")
    refusal_markers = ("kann ich nicht", "darf ich nicht", "nicht helfen", "cannot assist", "can't help")
    selected_cases = [case for case in CASES if not args.cases or case["name"] in args.cases]
    for case in selected_cases:
        started = time.monotonic()
        payload = {key: case[key] for key in ("question", "history", "chapterIds", "runBatches") if key in case}
        response = request(args.base, "/api/assistant/chat", payload)
        kinds = [proposal.get("kind") for proposal in response.get("proposals", [])]
        metrics = next((step for step in reversed(response.get("agentTrace", [])) if step.get("step") == "metrics"), {})
        repair_calls = int(metrics.get("repairCalls", sum(step.get("step") == "repair" for step in response.get("agentTrace", []))))
        message = response.get("message", "")
        checks = [bool(message), len(response.get("sources", [])) >= case.get("sources", 0)]
        if case.get("kind"):
            checks.append(case["kind"] in kinds)
        if case.get("kinds"):
            checks.append(set(case["kinds"]).issubset(kinds))
        if case.get("trace_step"):
            checks.append(any(step.get("step") == case["trace_step"] for step in response.get("agentTrace", [])))
        if case.get("no_refusal"):
            checks.append(not any(marker in message.casefold() for marker in refusal_markers))
        if case.get("forbid_proposals"):
            checks.append(not response.get("proposals"))
        if case.get("forbid_long_prose"):
            checks.append(len(message.split()) < 180)
        if case.get("message_contains"):
            checks.append(case["message_contains"].casefold() in message.casefold())
        if case.get("proposal_target"):
            checks.append(any(proposal.get("elementId") == case["proposal_target"] for proposal in response.get("proposals", [])))
        if case.get("clarification_ids"):
            checks.append({item.get("id") for item in (response.get("clarification") or {}).get("candidates", [])} == set(case["clarification_ids"]))
        if case.get("citations_resolve"):
            source_ids = {source.get("id") for source in response.get("sources", [])}
            checks.append(all(citation in source_ids for citation in response.get("citations", [])))
        if case.get("forbid_citation"):
            checks.append(case["forbid_citation"] not in response.get("citations", []) and case["forbid_citation"] not in {source.get("id") for source in response.get("sources", [])})
        for kind, maximum in case.get("max_kind_count", {}).items():
            checks.append(kinds.count(kind) <= maximum)
        reports.append({"name": case["name"], "passed": all(checks), "seconds": round(time.monotonic() - started, 2), "sources": len(response.get("sources", [])), "proposals": kinds, "repairCalls": repair_calls, "validWithoutRepair": bool(kinds) and repair_calls == 0, "message": message[:240]})
        print(f"[{reports[-1]['passed'] and 'PASS' or 'FAIL'}] {case['name']} ({reports[-1]['seconds']}s) {kinds}", flush=True)
    unchanged = request(args.base, "/api/state") == state_before
    proposal_reports = [report for report in reports if report["proposals"]]
    without_repair = sum(report["validWithoutRepair"] for report in proposal_reports)
    valid_without_repair_rate = without_repair / len(proposal_reports) if proposal_reports else 1.0
    result = {"modelAvailable": True, "chunks": status.get("chunks"), "passed": sum(report["passed"] for report in reports), "total": len(reports), "worldStateUnchanged": unchanged, "proposalResponses": len(proposal_reports), "proposalResponsesWithoutRepair": without_repair, "validProposalWithoutRepairRate": round(valid_without_repair_rate, 4), "reports": reports}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    raise SystemExit(0 if unchanged and all(report["passed"] for report in reports) and valid_without_repair_rate >= 0.95 else 1)


if __name__ == "__main__":
    main()
