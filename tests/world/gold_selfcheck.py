"""Self-check of the gold part against the matcher (T-289).

Reads one language's gold part as JSON from stdin, builds the matcher's tasks from
`world.evaluation.gold`, hands each `extract` task the world's own entries as proposals and
prints, per chapter and category, the F1 as JSON. A gold set that agrees with its own world
scores 1.0 everywhere; world.test.mjs asserts that.

The adaptation below (the world's field names to the matcher's) is test-side only; the runner
of part E has its own.
"""

import importlib.util
import json
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[2] / "tools/evaluation/assistant/goldset_match.py"
_spec = importlib.util.spec_from_file_location("goldset_match", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
gm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gm)

dump = json.loads(sys.stdin.buffer.read().decode("utf-8"))
gold = dump["evaluation"]["gold"]
titles = dump["evaluation"]["titles"].split("|")
nodes = {node["id"]: node for node in dump["nodes"]}
edges = {edge["id"]: edge for edge in dump["edges"]}
moments = {moment["id"]: moment for moment in dump["timeline"]}
presence = {entry["id"]: entry for entry in dump["presence"]}


def adapt(entry):
    out = {
        "id": entry["id"],
        "category": entry["category"],
        "required": entry["need"] == "required",
    }
    if entry["category"] in gm.ELEMENT_CATEGORIES:
        out |= {"types": [entry["type"]], "names": entry["names"].split("|")}
        if entry.get("ref"):
            out["id"] = entry["ref"]
    elif entry["category"] == "relation":
        out |= {
            "from": entry["from"],
            "to": entry["to"],
            "directed": entry["directed"],
            "relationshipKind": entry["relationshipKind"],
            "synonyms": entry["synonyms"].split("|"),
        }
    elif entry["category"] == "event":
        out |= {"keywords": entry["keys"].split("|"), "refs": entry["refs"]}
        if entry.get("date"):
            out["date"] = entry["date"]
    elif entry["category"] == "presence":
        out |= {"element": entry["elementId"], "place": entry["placeId"]}
    return out


def own_entries_as_proposals(entries):
    proposals = []
    for entry in entries:
        if entry["category"] in gm.ELEMENT_CATEGORIES:
            node = nodes[entry["ref"]]
            proposals.append(
                {
                    "kind": "create_element",
                    "tempId": f"new:{entry['ref']}",
                    "element": {"type": node["type"], "name": node["name"]},
                }
            )
    for entry in entries:
        ref = entry.get("ref")
        if entry["category"] == "relation":
            edge = edges[ref]
            proposals.append(
                {
                    "kind": "create_relationship",
                    "relationship": {
                        "from": f"new:{edge['from']}",
                        "to": f"new:{edge['to']}",
                        "label": edge["label"],
                        "directed": edge["directed"],
                        "relationshipKind": "general",
                    },
                }
            )
        elif entry["category"] == "event":
            moment = moments[ref]
            proposals.append(
                {
                    "kind": "create_timeline_moment",
                    "tempId": f"new:{ref}",
                    "moment": {
                        "title": moment["title"],
                        "note": moment.get("note", ""),
                        **({"date": moment["date"]} if moment.get("date") else {}),
                    },
                }
            )
        elif entry["category"] == "presence":
            row = presence[ref]
            proposals.append(
                {
                    "kind": "set_presence",
                    "elementId": f"new:{row['elementId']}",
                    "placeId": f"new:{row['placeId']}",
                    "momentId": f"new:{row['momentId']}",
                }
            )
    return proposals


report = {}
for chapter in sorted({entry["chapterId"] for entry in gold if entry["task"] == "extract"}):
    entries = [e for e in gold if e["task"] == "extract" and e["chapterId"] == chapter]
    task = {
        "id": f"extract:{chapter}",
        "kind": "extract",
        "mode": "A",
        "gold": [adapt(e) for e in entries],
        "titles": titles,
    }
    result = gm.match_task(task, own_entries_as_proposals(entries))
    per_category = gm.run_metrics([result], [task])["perCategory"]
    report[chapter] = {
        category: per_category[category]["f1"]
        for category in gm.CATEGORIES
        if any(result["counts"][category].values())
    }
print(json.dumps(report))
