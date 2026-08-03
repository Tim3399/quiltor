#!/usr/bin/env python3
"""Create or refresh a world seeded with a full-length public-domain novella,
for exercising Quiltor's LLM assistant against real prose instead of the
short synthetic fixture in create-ai-test-world.py.

Source text: "The Time Machine" by H. G. Wells (1895), Project Gutenberg
eBook #35 (https://www.gutenberg.org/ebooks/35). Published before 1929, so
it is in the public domain in the United States; Wells died in 1946, so the
work is also public domain worldwide under life+70 rules. The chapter split
in scripts/fixtures/the-time-machine.chapters.json was produced by stripping
the Project Gutenberg license header/footer from the plain-text edition and
segmenting on the book's own chapter headings - the prose itself is
untouched.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import storage

TITLE = "Quiltor Story-Testwelt – The Time Machine"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "the-time-machine.chapters.json"

ATTRIBUTION = (
    "The Time Machine by H. G. Wells (1895). Public domain text from Project "
    "Gutenberg (gutenberg.org/ebooks/35). Loaded for LLM capability testing: "
    "long-context comprehension, summarization and RAG over a real, "
    "unmodified narrative rather than the short synthetic test manuscript."
)


def main() -> None:
    chapters = json.loads(FIXTURE.read_text(encoding="utf-8"))
    manuscript = {"chapters": chapters, "note": ATTRIBUTION}

    existing = next((world for world in storage.list_worlds() if world["title"] == TITLE), None)
    world = existing or storage.create_world(TITLE)
    storage.activate_world(world["id"])
    storage.save_manuscript(manuscript)
    words = sum(len(chapter["body"].split()) for chapter in chapters)
    print(f"{world['id']}  ({len(chapters)} chapters, {words} words)")


if __name__ == "__main__":
    main()
