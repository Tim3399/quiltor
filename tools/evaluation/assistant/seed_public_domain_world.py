#!/usr/bin/env python3
"""Create or refresh a world seeded with a full-length public-domain novella,
for exercising Quiltor's LLM assistant against real prose instead of the
short synthetic fixture in seed_synthetic_world.py.

Source text: "The Time Machine" by H. G. Wells (1895), Project Gutenberg
eBook #35 (https://www.gutenberg.org/ebooks/35). Published before 1929, so
it is in the public domain in the United States; Wells died in 1946, so the
work is also public domain worldwide under life+70 rules. The chapter split
in fixtures/the-time-machine.chapters.json was produced by stripping
the Project Gutenberg license header/footer from the plain-text edition and
segmenting on the book's own chapter headings - the prose itself is
untouched.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "src"))

from quiltor.infrastructure.persistence.sqlite import config, world_catalog
from quiltor.infrastructure.persistence.sqlite import manuscript as manuscript_store

TITLE = "Quiltor Story-Testwelt – The Time Machine"  # noqa: RUF001 - German title with a real en dash
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

    paths = config.SQLitePaths.from_data_directory(config.DATA)
    existing = next(
        (world for world in world_catalog.list_worlds(paths=paths) if world["title"] == TITLE),
        None,
    )
    world = existing or world_catalog.create_world(TITLE, paths=paths)
    # There is no process-wide active world any more; write into this world's database.
    database = world_catalog.world_db_path(world["id"], paths=paths)
    manuscript_store.save(manuscript, db_path=database)
    words = sum(len(chapter["body"].split()) for chapter in chapters)
    print(f"{world['id']}  ({len(chapters)} chapters, {words} words)")


if __name__ == "__main__":
    main()
