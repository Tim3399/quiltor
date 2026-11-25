"""T-369 probe: which form of the extraction answer makes a small model propose?

Records the first part prompt of an extraction (world without the chapter's figures) as the
product sends it after T-369, then replays it to llama-server in variants, N samples each:
- product: as sent (step-wrapped, message before proposals);
- proposals_first: the same schema with `proposals` ordered before `message` in properties
  and in the system prompt's key list (grammar order follows property order);
- unwrapped: the plain reply object, without {"step": {"action", "final"}}.
- unwrapped_proposals_first: both.
Prints the proposal count per sample. Usage:
    py -3.12 tools/probes/t369/variants.py <out-dir> [chapter] [samples]   (QUILTOR_AI_URL set)
"""

from __future__ import annotations

import copy
import json
import os
import sys
import urllib.request
from pathlib import Path

from quiltor.application.story_world.read_tools import StoryWorldReadTools
from quiltor.infrastructure.inference.token_cache import BoundedTokenCountCache
from quiltor.modules.assistant import AssistantRuntime
from tests.python.test_assistant_budget import EXTRACTION
from tests.python.test_assistant_runtime import _Progress
from tests.python.test_world_selection import manuscript, test_world

OUT = Path(sys.argv[1])
CHAPTER = sys.argv[2] if len(sys.argv) > 2 else "c-arrival"
SAMPLES = int(sys.argv[3]) if len(sys.argv) > 3 else 3
URL = os.environ["QUILTOR_AI_URL"].rstrip("/") + "/v1/chat/completions"
KEYS = "Return valid JSON with keys message, citations, proposals."
KEYS_FIRST = "Return valid JSON with keys proposals, citations, message."


class Recorder:
    identity = "http://probe"

    def __init__(self):
        self.calls = []

    def reload(self):
        pass

    def status(self):
        return {"available": True, "mode": "local", "reason": ""}

    def invoke(self, payload):
        self.calls.append(copy.deepcopy(dict(payload)))
        final = {"message": "ok", "citations": [], "proposals": []}
        name = payload.get("response_format", {}).get("json_schema", {}).get("name")
        return {"step": {"action": "final", "final": final}} if name == "quiltor_read_tool_step" else final

    def count_tokens(self, text):
        return max(1, round(len(text) * 0.343))

    def close(self):
        pass


def stripped():
    figures = test_world()["figures"]
    text = next(c for c in manuscript()["chapters"] if c["id"] == CHAPTER)
    body = json.dumps(text, ensure_ascii=False)
    gone = {n["id"] for n in figures["nodes"] if n.get("name") and n["name"] in body}
    figures["nodes"] = [n for n in figures["nodes"] if n["id"] not in gone]
    figures["edges"] = [e for e in figures["edges"] if e["from"] not in gone and e["to"] not in gone]
    return figures


def reorder(reply):
    props = reply["properties"]
    reply["properties"] = {k: props[k] for k in ("proposals", "citations", "message")}
    reply["required"] = ["proposals", "citations", "message"]
    return reply


def send(payload):
    body = {k: v for k, v in payload.items() if not k.startswith("_")}
    request = urllib.request.Request(URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=300) as response:
        choice = json.loads(response.read())["choices"][0]
        return choice["message"]["content"], choice.get("finish_reason")


engine = Recorder()
runtime = AssistantRuntime(Path("."), Path("."), engine, progress=_Progress(),
                           read_tools=StoryWorldReadTools(), token_cache=BoundedTokenCountCache())
runtime.complete(EXTRACTION, manuscript(), stripped(), chapter_ids=[CHAPTER], mode="world_extraction")
product = engine.calls[0]
step = product["response_format"]["json_schema"]["schema"]
reply = step["properties"]["step"]["anyOf"][0]["properties"]["final"]


def variant(wrapped, first):
    payload = copy.deepcopy(product)
    final = reorder(copy.deepcopy(reply)) if first else copy.deepcopy(reply)
    if first:
        payload["messages"][0]["content"] = payload["messages"][0]["content"].replace(KEYS, KEYS_FIRST)
    if wrapped:
        schema = copy.deepcopy(step)
        schema["properties"]["step"]["anyOf"][0]["properties"]["final"] = final
        payload["response_format"]["json_schema"]["schema"] = schema
    else:
        payload["response_format"]["json_schema"] = {"name": "quiltor_reply", "strict": True, "schema": final}
    return payload


OUT.mkdir(parents=True, exist_ok=True)
summary = {}
for label, wrapped, first in (
    ("product", True, False),
    ("proposals_first", True, True),
    ("unwrapped", False, False),
    ("unwrapped_proposals_first", False, True),
):
    counts = []
    for attempt in range(1, SAMPLES + 1):
        text, finish = send(variant(wrapped, first))
        (OUT / f"{CHAPTER}-{label}-{attempt}.json").write_text(text, encoding="utf-8")
        try:
            data = json.loads(text)
            final = data["step"]["final"] if "step" in data else data
            counts.append(len(final.get("proposals") or []))
        except (ValueError, KeyError, TypeError):
            counts.append(f"unparsed ({finish})")
    summary[label] = counts
    print(label, counts, flush=True)
(OUT / f"{CHAPTER}-summary.json").write_text(json.dumps(summary), encoding="utf-8")
