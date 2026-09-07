"""The schema step that renames the last two German keys inside stored assistant answers.

`notizen` and `gerichtet` never reached a column -- profiles and edges have been stored as
`notes` and `directed` all along. The assistant's history is the one place that kept them,
because it stores an answer verbatim, and a stored proposal can still be applied. Under the
new spelling the old key is simply unknown, so the note would disappear on the way in
without anyone being told.
"""

import json
import sqlite3
import unittest
from contextlib import closing

from quiltor.infrastructure.persistence.sqlite import migrations, schema


def _world_at_version_thirteen(connection: sqlite3.Connection, response: object) -> None:
    connection.executescript(schema.SCHEMA)
    connection.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version','13')")
    connection.execute(
        "INSERT INTO assistant_interactions(id,created_at,question,response_json,status) "
        "VALUES('one','2026-01-01T00:00:00Z','Wer ist das?',?,'completed')",
        (json.dumps(response, ensure_ascii=False),),
    )


def _stored_response(connection: sqlite3.Connection) -> dict:
    row = connection.execute(
        "SELECT response_json FROM assistant_interactions WHERE id='one'"
    ).fetchone()
    return json.loads(row[0])


def _proposal(profile: dict) -> dict:
    return {
        "message": "Ein Vorschlag.",
        "proposals": [
            {"kind": "create_element", "tempId": "new:x", "element": {"profile": profile}}
        ],
    }


class AssistantHistoryFieldMigrationTests(unittest.TestCase):
    def test_a_stored_note_survives_under_the_new_name(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_thirteen(connection, _proposal({"notizen": "Trägt einen Mantel."}))

            migrations.migrate(connection, 13)

            profile = _stored_response(connection)["proposals"][0]["element"]["profile"]
        self.assertEqual(profile["notes"], "Trägt einen Mantel.")
        self.assertNotIn("notizen", profile)

    def test_a_stored_relationship_direction_survives(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_thirteen(
                connection,
                {
                    "proposals": [
                        {"kind": "create_relationship", "gerichtet": True, "label": "kennt"}
                    ]
                },
            )

            migrations.migrate(connection, 13)

            proposal = _stored_response(connection)["proposals"][0]
        self.assertIs(proposal["directed"], True)
        self.assertNotIn("gerichtet", proposal)
        self.assertEqual(proposal["label"], "kennt")

    def test_the_english_key_wins_when_both_are_present(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_thirteen(connection, _proposal({"notizen": "alt", "notes": "neu"}))

            migrations.migrate(connection, 13)

            profile = _stored_response(connection)["proposals"][0]["element"]["profile"]
        self.assertEqual(profile["notes"], "neu")
        self.assertNotIn("notizen", profile)

    def test_cited_prose_is_left_alone(self) -> None:
        """The words also occur in what the assistant quotes. Only keys are renamed."""

        prose = "Der Blick war auf den Hafen gerichtet, daneben lagen ihre notizen."
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_thirteen(
                connection,
                {"sources": [{"id": "chapter:a:0", "kind": "chapter", "text": prose}]},
            )

            migrations.migrate(connection, 13)

            stored = _stored_response(connection)
        self.assertEqual(stored["sources"][0]["text"], prose)

    def test_a_history_without_the_old_keys_is_untouched(self) -> None:
        response = _proposal({"notes": "Schon englisch."})
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_thirteen(connection, response)

            migrations.migrate(connection, 13)

            stored = _stored_response(connection)
        self.assertEqual(stored, response)

    def test_an_unreadable_response_does_not_stop_the_step(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.executescript(schema.SCHEMA)
            connection.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version','13')"
            )
            connection.execute(
                "INSERT INTO assistant_interactions(id,created_at,question,response_json,status) "
                "VALUES('broken','2026-01-01T00:00:00Z','?','{nicht json','completed')"
            )
            connection.execute(
                "INSERT INTO assistant_interactions(id,created_at,question,response_json,status) "
                "VALUES('one','2026-01-02T00:00:00Z','?',?,'completed')",
                (json.dumps(_proposal({"notizen": "bleibt"}), ensure_ascii=False),),
            )

            migrations.migrate(connection, 13)

            profile = _stored_response(connection)["proposals"][0]["element"]["profile"]
        self.assertEqual(profile["notes"], "bleibt")

    def test_the_step_is_idempotent(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_thirteen(connection, _proposal({"notizen": "einmal"}))

            migrations.migrate(connection, 13)
            once = _stored_response(connection)
            migrations.migrate(connection, schema.SCHEMA_VERSION)

            self.assertEqual(_stored_response(connection), once)

    def test_a_bare_meta_database_survives_the_step(self) -> None:
        """The ladder also runs against databases that carry nothing but `meta`."""

        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")

            migrations.migrate(connection, 13)

            row = connection.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        self.assertEqual(row[0], str(schema.SCHEMA_VERSION))


if __name__ == "__main__":
    unittest.main()
