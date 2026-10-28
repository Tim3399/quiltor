"""Export the assistant's real JSON schemas for the browser-inference measurements (T-54).

    PYTHONPATH=src py -3.12 tools/evaluation/browser-inference/export_schemas.py

Writes one file per schema into `schemas/` next to this script. The schemas come straight from
`quiltor.modules.assistant.schemas`, so the measurements test exactly what the server sends to
a model; nothing is simplified here. Re-run it after a schema change and commit the result.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from quiltor.application.story_world.read_tools import read_tool_catalog
from quiltor.modules.assistant.schemas import KINDS, planner_schema, reply_schema, tool_step_schema

OUT = Path(__file__).resolve().parent / "schemas"


def schemas() -> dict[str, dict[str, Any]]:
    """Every schema the assistant sends, in the shapes the measurements need."""

    catalog = read_tool_catalog()
    return {
        # The reply with every proposal kind: oneOf, const, enum, pattern, maxItems, uniqueItems.
        "reply_schema": reply_schema(KINDS),
        # The reply without proposals, the "question and answer" cut A-2 suggests first.
        "reply_schema_no_proposals": reply_schema(()),
        "tool_step_schema": tool_step_schema(catalog, KINDS),
        "planner_schema": planner_schema(KINDS),
    }


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, schema in schemas().items():
        path = OUT / f"{name}.json"
        # Keep the definition order: the server sends the schema unsorted
        # (infrastructure/inference/shared/contract.py), and XGrammar enforces property order.
        text = json.dumps(schema, indent=2) + "\n"
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(OUT.parent)}")


if __name__ == "__main__":
    main()
