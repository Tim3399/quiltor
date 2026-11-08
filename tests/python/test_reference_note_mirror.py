"""The Markdown mirrors follow a migration that changed notes (T-186, F-177-8).

Schema 15 appends the text of Storyboard reference cards to the notes of their chapters and
figures. The mirrors are only rewritten on a save, so a world opened after the upgrade kept
showing the old notes in its Markdown files until the author happened to save that document.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.sqlite import config, schema
from quiltor.infrastructure.persistence.sqlite.connection import connection

OWNER = "local-user"
DOCUMENTS = SQLiteDocumentRepository()


class MirrorAfterMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.paths = config.SQLitePaths.from_data_directory(Path(self.temporary.name))
        self.worlds = SQLiteWorldRepository(self.paths)
        self.worlds.prepare()
        self.world = self.worlds.create("Atlas", "", OWNER)
        self.location = self.worlds.paths_for(self.world.id).documents

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _upgrade_from_schema_14(self) -> None:
        database = self.location.database
        DOCUMENTS.save(
            "manuscript",
            {"chapters": [{"id": "k1", "title": "Ankunft", "body": "Morgen.", "note": "Alt."}]},
            None,
            database,
        )
        DOCUMENTS.save(
            "figures",
            {
                "nodes": [
                    {
                        "id": "mira",
                        "type": "person",
                        "name": "Mira",
                        "x": 0,
                        "y": 0,
                        "profile": {"notes": "Kennt das Archiv."},
                    }
                ],
                "edges": [],
            },
            None,
            database,
        )
        with connection(database) as connected:
            connected.execute(
                "INSERT OR REPLACE INTO storyboards(id,position,title,extra_json)"
                " VALUES('main-storyboard',0,'Main','{}')"
            )
            for card_id, kind, target in (("c1", "chapter", "k1"), ("c2", "entity", "mira")):
                connected.execute(
                    "INSERT INTO storyboard_nodes("
                    " id,board_id,position,kind,x,y,text,target_kind,target_id,extra_json"
                    ") VALUES(?,'main-storyboard',0,'reference',0,0,?,?,?,?)",
                    (
                        card_id,
                        "Kartentext.",
                        kind,
                        target,
                        json.dumps({"text": "Kartentext."}),
                    ),
                )
            connected.execute("UPDATE meta SET value='14' WHERE key='schema_version'")

    def _mirrors(self) -> str:
        files = [
            *self.location.manuscript_mirrors.glob("*.md"),
            *self.location.story_world_mirrors.glob("*.md"),
        ]
        return "\n".join(path.read_text(encoding="utf-8") for path in sorted(files))

    def test_opening_an_upgraded_world_brings_the_mirrors_up_to_date(self) -> None:
        self._upgrade_from_schema_14()
        self.assertNotIn("Kartentext.", self._mirrors())

        self.worlds.open(self.world.id, OWNER)

        mirrors = self._mirrors()
        self.assertEqual(mirrors.count("Kartentext."), 2, mirrors)
        self.assertIn("Alt.", mirrors)

    def test_opening_a_current_world_leaves_the_mirrors_alone(self) -> None:
        self._upgrade_from_schema_14()
        schema.initialize(self.location.database)
        stale = self.location.manuscript_mirrors / "01 - Ankunft.md"
        stale.write_text("von Hand\n", encoding="utf-8")

        self.worlds.open(self.world.id, OWNER)

        self.assertEqual(stale.read_text(encoding="utf-8"), "von Hand\n")


if __name__ == "__main__":
    unittest.main()
