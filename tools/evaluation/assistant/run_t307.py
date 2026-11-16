"""Real-model runs for the context budget (T-307): the example world, asked through llama.cpp.

Starts an isolated Quiltor of the given checkout on a free port with QUILTOR_HOME in a temporary
directory, seeds the shipped example world (or that world plus generated elements, so the state
is certain to be shortened), and asks each question several times. One JSON line per run:
the budget step of the agent trace, the read tools called, finishReason, whether the answer was
the fallback text, an excerpt of the answer and, for profile edits, whether the proposed profile
is shorter than the stored one. The checkout under test is --checkout, so the same script
measures before and after a change.

    py -3.12 tools/evaluation/assistant/run_t307.py --world example --runs 5 \\
        --binary <llama-server> --model <Qwen3-4B-Q4_K_M.gguf> --output t307.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from run_scenarios import assistant_request, request  # noqa: E402

FALLBACK = "Der sichere Leseschritt konnte nicht abgeschlossen werden."
# Each case: name, the conversation before it (questions whose answers become the history),
# the question measured.
CASES: list[tuple[str, list[str], str]] = [
    ("Q1", [], "Wer kommt in dieser Welt vor?"),
    ("Q2", [], "Was weißt du über Mara Venn?"),
    ("Q3", [], "Ergänze in Ivens Steckbrief, dass er Salzspuren an den Stiefeln trägt."),
    (
        "Q3b",
        ["Was weißt du über Iven Rook?"],
        "Ergänze bei ihm, dass er Salzspuren an den Stiefeln trägt.",
    ),
    # Only Oda's profile notes say whether she believes the rumours; the follow-up names nobody.
    ("Q4", ["Wer ist die Hafenmeisterin?"], "Und glaubt sie an die Gerüchte über den Atlas?"),
]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def example_world(checkout: Path, generated: int) -> dict[str, Any]:
    world = json.loads(
        (checkout / "src/quiltor/resources/example_world/de.json").read_text(encoding="utf-8")
    )
    figures = world["storyWorld"]
    for index in range(generated):
        figures["nodes"].append(
            {
                "id": f"gen-{index:03d}",
                "type": "person" if index % 2 else "ort",
                "name": f"Nebengestalt {index:03d}",
                "label": "Hafenvolk",
                "sub": "Kommt im Manuskript nicht vor.",
                "profile": {"notes": "Eine Randnotiz ohne Bedeutung für die Handlung. " * 3},
                "x": 40 + index,
                "y": 40 + index,
            }
        )
    return world


def put_versioned(base: str, path: str, contract: str, payload: Any) -> None:
    with urllib.request.urlopen(base + path) as response:
        revision = int((response.headers.get("ETag") or '"0"').strip('"'))
    body = json.dumps(
        {"contract": contract, "version": 1, "revision": revision, "payload": payload}
    ).encode()
    put = urllib.request.Request(
        base + path,
        data=body,
        method="PUT",
        headers={"Content-Type": "application/json", "If-Match": f'"{revision}"'},
    )
    urllib.request.urlopen(put).read()


def profile_text(profile: Any) -> str:
    if not isinstance(profile, dict):
        return ""
    fields = " ".join(str(item.get("value") or "") for item in profile.get("fields") or [])
    return f"{fields} {profile.get('notes') or ''}".strip()


def summarize(result: dict[str, Any], stored: dict[str, Any], seconds: float) -> dict[str, Any]:
    trace = result.get("agentTrace") or []
    budget = next((step for step in trace if step.get("step") == "budget"), None)
    metrics = next((step for step in trace if step.get("step") == "metrics"), {})
    loop = next((step for step in trace if step.get("step") == "tool_loop"), {})
    message = str(result.get("message") or "")
    shorter = []
    for proposal in result.get("proposals") or []:
        if proposal.get("kind") == "update_element":
            ident = proposal.get("elementId")
            new = profile_text((proposal.get("patch") or {}).get("profile"))
            old = profile_text((stored.get(ident) or {}).get("profile"))
            if new:
                shorter.append({"elementId": ident, "shorter": len(new) < len(old)})
    return {
        "seconds": round(seconds, 1),
        "fallback": FALLBACK in message,
        "messageHead": message[:200],
        "budget": budget,
        "tools": [
            {"name": step.get("name"), "status": step.get("status")}
            for step in trace
            if step.get("step") == "read_tool"
        ],
        "finalOnly": any(step.get("step") == "tool_loop_final_only" for step in trace),
        "toolLoop": {key: loop.get(key) for key in ("complete", "reason", "toolRounds")},
        "promptTokens": metrics.get("promptTokens"),
        "finishReason": metrics.get("finishReason"),
        "proposals": [proposal.get("kind") for proposal in result.get("proposals") or []],
        "profileEdits": shorter,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkout", type=Path, default=ROOT)
    parser.add_argument("--world", choices=("example", "large"), default="example")
    parser.add_argument("--generated", type=int, default=200)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--case", action="append", dest="cases")
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    checkout = args.checkout.resolve()
    world = example_world(checkout, args.generated if args.world == "large" else 0)
    stored = {node["id"]: node for node in world["storyWorld"]["nodes"]}
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    home = tempfile.mkdtemp(prefix="quiltor-t307-")
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(checkout / "src"), str(checkout)]),
        "QUILTOR_HOME": home,
        "QUILTOR_AI_BINARY": str(args.binary),
        "QUILTOR_AI_MODEL": str(args.model),
        "QUILTOR_CREDENTIAL_BACKEND": "memory",
        "PYTHONUNBUFFERED": "1",
    }
    log_path = Path(home) / "server.log"
    output = args.output.open("a", encoding="utf-8") if args.output else None
    with log_path.open("w", encoding="utf-8") as log:
        server = subprocess.Popen(
            [sys.executable, str(checkout / "apps/web/server.py"), str(port), "--no-open"],
            cwd=checkout,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            for _ in range(120):
                try:
                    urllib.request.urlopen(base + "/api/capabilities", timeout=2)
                    break
                except OSError:
                    time.sleep(1)
            created = request(base, "/api/worlds/create", {"title": "T-307", "backupUrl": ""})
            world_id = created["world"]["id"]
            for endpoint, contract, key in (
                ("state", "quiltor.story-world", "storyWorld"),
                ("manuscript", "quiltor.manuscript", "manuscript"),
                ("storyboards", "quiltor.storyboards", "storyboards"),
            ):
                put_versioned(base, f"/api/{endpoint}?world={world_id}", contract, world[key])
            request(base, "/api/worlds/open", {"id": world_id})
            for _ in range(240):
                if request(base, f"/api/assistant/status?world={world_id}").get("available"):
                    break
                time.sleep(1)
            else:
                raise SystemExit("The local model did not become ready.")
            commit = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=checkout, capture_output=True, text=True
            ).stdout.strip()
            for name, before, question in CASES:
                if args.cases and name not in args.cases:
                    continue
                for run in range(1, args.runs + 1):
                    line: dict[str, Any] = {
                        "commit": commit,
                        "world": args.world,
                        "case": name,
                        "run": run,
                    }
                    history: list[dict[str, str]] = []
                    started = time.monotonic()
                    try:
                        for earlier in before:
                            answer = assistant_request(
                                base,
                                world_id,
                                {"question": earlier, "history": history, "language": "de"},
                            )
                            history += [
                                {"role": "user", "content": earlier},
                                {"role": "assistant", "content": str(answer.get("message") or "")},
                            ]
                        started = time.monotonic()
                        result = assistant_request(
                            base,
                            world_id,
                            {"question": question, "history": history, "language": "de"},
                        )
                        line.update(summarize(result, stored, time.monotonic() - started))
                    # A failed job is a measurement too; record it and go on with the next run.
                    except RuntimeError as error:
                        line.update(
                            {
                                "seconds": round(time.monotonic() - started, 1),
                                "error": str(error),
                                "inHistory": len(history) < 2 * len(before),
                            }
                        )
                    print(json.dumps(line, ensure_ascii=False), flush=True)
                    if output:
                        output.write(json.dumps(line, ensure_ascii=False) + "\n")
                        output.flush()
        finally:
            server.terminate()
            server.wait(timeout=30)
            if output:
                output.close()


if __name__ == "__main__":
    main()
