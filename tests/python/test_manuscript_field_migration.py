"""The schema step that renames the last two German manuscript settings.

Until v3.16 the insert panel stored its hidden world elements as `elementeVerborgen`, and
the settings bag could carry a stale `zeichenAktiv` next to the column that actually holds
the active symbols. Both names are gone now -- not merely unused: the wire validator refuses
them, so a world that still carried one would stop loading. This step is what makes sure
none does.
"""

import json
import sqlite3
import unittest
from contextlib import closing

from quiltor.infrastructure.persistence.sqlite import migrations, schema


def _world_at_version_twelve(connection: sqlite3.Connection, extra: dict[str, object]) -> None:
    connection.executescript(schema.SCHEMA)
    connection.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version','12')",
    )
    connection.execute(
        "INSERT OR REPLACE INTO manuscript_settings(id,words_json,characters_json,extra_json) "
        "VALUES(1,'[]','[]',?)",
        (json.dumps(extra, ensure_ascii=False),),
    )


def _settings_extra(connection: sqlite3.Connection) -> dict[str, object]:
    row = connection.execute("SELECT extra_json FROM manuscript_settings WHERE id=1").fetchone()
    return json.loads(row[0])


class ManuscriptFieldMigrationTests(unittest.TestCase):
    def test_hidden_elements_keep_their_value_under_the_new_name(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_twelve(connection, {"elementeVerborgen": ["mara", "archiv"]})

            migrations.migrate(connection, 12)

            extra = _settings_extra(connection)
        self.assertEqual(extra["hiddenElements"], ["mara", "archiv"])
        self.assertNotIn("elementeVerborgen", extra)

    def test_a_stale_active_symbol_key_is_dropped_from_the_bag(self) -> None:
        """The symbols live in `characters_json`; a copy in the bag is a leftover."""

        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_twelve(connection, {"zeichenAktiv": ["„", "“"]})

            migrations.migrate(connection, 12)

            extra = _settings_extra(connection)
        self.assertNotIn("zeichenAktiv", extra)
        self.assertNotIn("activeSymbols", extra)

    def test_everything_else_in_the_bag_survives(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_twelve(
                connection,
                {"elementeVerborgen": ["mara"], "language": "de-DE", "grammarMode": "manual"},
            )

            migrations.migrate(connection, 12)

            extra = _settings_extra(connection)
        self.assertEqual(extra["language"], "de-DE")
        self.assertEqual(extra["grammarMode"], "manual")

    def test_a_world_without_either_key_is_left_alone(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_twelve(connection, {"language": "de-DE"})

            migrations.migrate(connection, 12)

            extra = _settings_extra(connection)
        self.assertEqual(extra, {"language": "de-DE"})

    def test_an_already_migrated_world_does_not_lose_its_hidden_elements(self) -> None:
        """Running the ladder twice must not undo the first pass."""

        with closing(sqlite3.connect(":memory:")) as connection:
            _world_at_version_twelve(connection, {"elementeVerborgen": ["mara"]})

            migrations.migrate(connection, 12)
            migrations.migrate(connection, 13)

            extra = _settings_extra(connection)
        self.assertEqual(extra["hiddenElements"], ["mara"])


if __name__ == "__main__":
    unittest.main()
