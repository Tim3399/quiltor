#!/usr/bin/env python3
"""Run the persistent Quiltor AI test world through core product scenarios."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request


CASES = [
    {"name": "chapter-rag", "question": "Warum misstraut Mara Corvin nach der Krönung? Antworte mit Quellen.", "sources": 1},
    {"name": "cross-source-rag", "question": "Welche Hinweise verbinden das Staatssiegel, die Wasserstollen und den Orden?", "sources": 2},
    {"name": "create-element", "question": "Lege das im letzten Kapitel erwähnte Frostkloster als Ort an.", "kind": "create_element"},
    {"name": "create-relationship", "question": "Schlage eine gerichtete Beziehung von Priorin Elian zum Staatssiegel vor: Sie besitzt es nach dem Nordtor.", "kind": "create_relationship"},
    {"name": "timeline", "question": "Lege einen Zeitpunkt für den Fund des Siegels im Frostkloster nach dem Prozess an.", "kind": "create_timeline_moment"},
    {"name": "sensitive-thriller", "question": "Analysiere sachlich, welche Folgen die Gewalt und Zwangsrekrutierung des Ordens für Mara und die verschwundenen Jugendlichen hat. Lehne das Thema nicht ab.", "sources": 1, "no_refusal": True},
    {"name": "no-prose-writing", "question": "Schreibe die nächste Thrillerszene als fertige Romanprosa.", "forbid_proposals": True, "forbid_long_prose": True},
]


def request(base: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=body, headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=240) as response:
        return json.loads(response.read())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8102")
    parser.add_argument("--world", required=True)
    parser.add_argument("--case", action="append", dest="cases", help="Run only the named case; may be repeated.")
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
    refusal_markers = ("kann ich nicht", "darf ich nicht", "nicht helfen", "cannot assist", "can't help")
    selected_cases = [case for case in CASES if not args.cases or case["name"] in args.cases]
    for case in selected_cases:
        started = time.monotonic()
        response = request(args.base, "/api/assistant/chat", {"question": case["question"]})
        kinds = [proposal.get("kind") for proposal in response.get("proposals", [])]
        message = response.get("message", "")
        checks = [bool(message), len(response.get("sources", [])) >= case.get("sources", 0)]
        if case.get("kind"):
            checks.append(case["kind"] in kinds)
        if case.get("no_refusal"):
            checks.append(not any(marker in message.casefold() for marker in refusal_markers))
        if case.get("forbid_proposals"):
            checks.append(not response.get("proposals"))
        if case.get("forbid_long_prose"):
            checks.append(len(message.split()) < 180)
        reports.append({"name": case["name"], "passed": all(checks), "seconds": round(time.monotonic() - started, 2), "sources": len(response.get("sources", [])), "proposals": kinds, "message": message[:240]})
    print(json.dumps({"modelAvailable": True, "chunks": status.get("chunks"), "passed": sum(report["passed"] for report in reports), "total": len(reports), "reports": reports}, ensure_ascii=False, indent=2))
    raise SystemExit(0 if all(report["passed"] for report in reports) else 1)


if __name__ == "__main__":
    main()
