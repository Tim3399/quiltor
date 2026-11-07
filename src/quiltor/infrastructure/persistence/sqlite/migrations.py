"""Explicit forward-only SQLite migrations."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from typing import Any

from quiltor.domain.story_world.profile import (
    LEGACY_PROFILE_FIELDS,
    legacy_extra_field_id,
    legacy_profile_field_id,
)
from quiltor.domain.storyboard import DEFAULT_STORYBOARD_ID, DEFAULT_STORYBOARD_TITLE
from quiltor.domain.storyboard.element_notes import (
    ElementKey,
    ElementNote,
    ReferenceCardNote,
    append_reference_notes,
    discarded_protocol,
)
from quiltor.infrastructure.persistence.sqlite import config
from quiltor.infrastructure.persistence.sqlite.schema import SCHEMA_VERSION
from quiltor.infrastructure.persistence.sqlite.temporal import FIELDS_KEY, migrate_legacy_state
from quiltor.infrastructure.persistence.sqlite.time_system import ensure_primary

_GERMAN_KEYS = {"notizen": "notes", "gerichtet": "directed"}


def _rename_german_keys(value: object) -> bool:
    """Rename the two retired keys anywhere in a decoded response; report whether it did.

    An English key already present wins: it is what the current code writes, and a document
    carrying both spellings would only be a second source of truth.
    """

    changed = False
    if isinstance(value, dict):
        for german, english in _GERMAN_KEYS.items():
            if german not in value:
                continue
            retired = value.pop(german)
            if english not in value:
                value[english] = retired
            changed = True
        for item in value.values():
            changed = _rename_german_keys(item) or changed
    elif isinstance(value, list):
        for item in value:
            changed = _rename_german_keys(item) or changed
    return changed


# Where the step of schema 15 leaves its count of dropped card texts: per board and element,
# never the text itself (D-100). The database is the world, so the world is implied.
DISCARDED_NOTES_META_KEY = "migration_v15_discarded_notes"
_CARD_NOTE_KEYS = ("text", "noteReferences", "noteMarks")


def _table_exists(database: sqlite3.Connection, name: str) -> bool:
    return (
        database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _json_object(raw: object) -> dict[str, Any]:
    try:
        value = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _rows(value: object) -> tuple[dict[str, Any], ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, dict))


def _with_note_ranges(extra: dict[str, Any], note: ElementNote) -> dict[str, Any]:
    updated = dict(extra)
    for key, rows in (("noteReferences", note.references), ("noteMarks", note.marks)):
        if rows or key in updated:
            updated[key] = list(rows)
    return updated


def _bump_revision(database: sqlite3.Connection, kind: str) -> None:
    database.execute(
        "UPDATE meta SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key=?",
        (f"{kind}_revision",),
    )


def _move_reference_card_notes(database: sqlite3.Connection) -> None:
    """Schema 15: a reference card's text joins the one note of its element (T-177).

    See domain/storyboard/element_notes.py for the format and the rules. Every reference
    card leaves this step without text, references or marks; a card whose element is gone,
    or whose block would break a limit, loses its text and is counted under
    DISCARDED_NOTES_META_KEY. Deterministic: the cloud pull migrates a snapshot and compares
    it with what the world became (F-177-1).
    """

    if not _table_exists(database, "storyboards") or not _table_exists(
        database, "storyboard_nodes"
    ):
        return
    boards = {
        row[0]: (row[1], row[2])
        for row in database.execute("SELECT id, position, title FROM storyboards")
    }
    cards: list[ReferenceCardNote] = []
    cleaned: list[tuple[str, str]] = []
    for node_id, board_id, position, column_text, target_kind, target_id, raw in database.execute(
        "SELECT id, board_id, position, text, target_kind, target_id, extra_json"
        " FROM storyboard_nodes WHERE kind='reference' ORDER BY id"
    ):
        extra = _json_object(raw)
        # The loader reads a card's text from extra_json; the column is a copy (storyboards.py).
        stored_text = extra.get("text")
        text = stored_text if isinstance(stored_text, str) else column_text or ""
        position_on_board, title = boards.get(board_id, (0, ""))
        cards.append(
            ReferenceCardNote(
                board_id=board_id,
                board_title=title,
                board_position=position_on_board,
                card_id=node_id,
                card_position=position,
                target_kind=target_kind,
                target_id=target_id,
                text=text,
                references=_rows(extra.get("noteReferences")),
                marks=_rows(extra.get("noteMarks")),
            )
        )
        # Only what holds something goes; an empty note is what the client writes anyway.
        if column_text or any(extra.get(key) for key in _CARD_NOTE_KEYS):
            for key in _CARD_NOTE_KEYS:
                if extra.get(key):
                    extra.pop(key)
            cleaned.append((json.dumps(extra, ensure_ascii=False), node_id))

    notes: dict[ElementKey, ElementNote] = {}
    chapter_extra: dict[str, dict[str, Any]] = {}
    if _table_exists(database, "chapters"):
        for chapter_id, note, raw in database.execute("SELECT id, note, extra_json FROM chapters"):
            extra = _json_object(raw)
            chapter_extra[chapter_id] = extra
            notes[("chapter", chapter_id)] = ElementNote(
                note, _rows(extra.get("noteReferences")), _rows(extra.get("noteMarks"))
            )
    profile_extra: dict[str, dict[str, Any] | None] = {}
    if _table_exists(database, "figures") and _table_exists(database, "profiles"):
        profiles = {
            row[0]: (row[1], _json_object(row[2]))
            for row in database.execute("SELECT figure_id, notes, extra_json FROM profiles")
        }
        for (figure_id,) in database.execute("SELECT id FROM figures"):
            note, extra = profiles.get(figure_id, ("", None))
            profile_extra[figure_id] = extra
            notes[("figure", figure_id)] = ElementNote(
                note,
                _rows((extra or {}).get("noteReferences")),
                _rows((extra or {}).get("noteMarks")),
            )
    moment_extra: dict[str, dict[str, Any]] = {}
    if _table_exists(database, "timeline_moments"):
        for moment_id, note, raw in database.execute(
            "SELECT id, note, extra_json FROM timeline_moments"
        ):
            extra = _json_object(raw)
            fields = extra.get(FIELDS_KEY)
            # A moment that never carried a note field shows none; its column is not its note.
            shown = note if not isinstance(fields, list) or "note" in fields else ""
            moment_extra[moment_id] = extra
            notes[("moment", moment_id)] = ElementNote(
                shown, _rows(extra.get("noteReferences")), _rows(extra.get("noteMarks"))
            )

    result = append_reference_notes(cards, notes)
    changed_families: set[str] = set()
    for (family, element_id), note in sorted(result.notes.items()):
        if family == "chapter":
            extra_json = json.dumps(
                _with_note_ranges(chapter_extra[element_id], note), ensure_ascii=False
            )
            database.execute(
                "UPDATE chapters SET note=?, extra_json=? WHERE id=?",
                (note.text, extra_json, element_id),
            )
            changed_families.add("manuscript")
        elif family == "figure":
            stored = profile_extra[element_id]
            extra_json = json.dumps(_with_note_ranges(stored or {}, note), ensure_ascii=False)
            if stored is None:
                # A figure without a profile row: create it the way story_world._sync does.
                database.execute(
                    "INSERT INTO profiles(figure_id, notes, extra_json) VALUES(?,?,?)",
                    (element_id, note.text, extra_json),
                )
            else:
                database.execute(
                    "UPDATE profiles SET notes=?, extra_json=? WHERE figure_id=?",
                    (note.text, extra_json, element_id),
                )
            changed_families.add("figures")
        else:
            extra = _with_note_ranges(moment_extra[element_id], note)
            fields = extra.get(FIELDS_KEY)
            if isinstance(fields, list) and "note" not in fields:
                extra[FIELDS_KEY] = [*fields, "note"]
            database.execute(
                "UPDATE timeline_moments SET note=?, extra_json=? WHERE id=?",
                (note.text, json.dumps(extra, ensure_ascii=False), element_id),
            )
            changed_families.add("figures")
    if cleaned:
        database.executemany(
            "UPDATE storyboard_nodes SET text='', extra_json=? WHERE id=?", cleaned
        )
        changed_families.add("storyboards")
    for family in sorted(changed_families):
        _bump_revision(database, family)
    if result.discarded:
        database.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
            (
                DISCARDED_NOTES_META_KEY,
                json.dumps(discarded_protocol(result.discarded), ensure_ascii=False),
            ),
        )


def migrate(database: sqlite3.Connection, version: int) -> None:
    """Apply every missing step; each migration remains idempotent."""

    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('manuscript_revision','0')")
    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('figures_revision','0')")
    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('storyboards_revision','0')")
    database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('storyboards_extra_json','{}')")
    if version < 2:
        database.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('last_restore_at','')")
    if version < 3:
        database.execute(
            "INSERT OR IGNORE INTO meta(key,value) VALUES('owner_sub',?)",
            (config.LOCAL_OWNER,),
        )
    if version < 4:
        columns = {row[1] for row in database.execute("PRAGMA table_info(figures)")}
        if "death_moment_id" not in columns:
            database.execute(
                "ALTER TABLE figures ADD COLUMN death_moment_id TEXT "
                "REFERENCES timeline_moments(id) ON DELETE SET NULL"
            )
        migrate_legacy_state(database)
    if version < 5:
        ensure_primary(database)
    if version < 6:
        database.execute(
            "CREATE INDEX IF NOT EXISTS alias_lookup ON entity_aliases(normalized_alias)"
        )
    if version < 7:
        database.execute(
            "UPDATE meta SET value=? WHERE key='owner_sub' AND value=''",
            (config.LOCAL_OWNER,),
        )
    if version < 8:
        chapters_exist = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapters'"
        ).fetchone()
        if chapters_exist:
            columns = {row[1] for row in database.execute("PRAGMA table_info(chapters)")}
            if "story_time_start_moment_id" not in columns:
                database.execute(
                    "ALTER TABLE chapters ADD COLUMN story_time_start_moment_id TEXT "
                    "REFERENCES timeline_moments(id) ON DELETE RESTRICT"
                )
            if "story_time_end_moment_id" not in columns:
                database.execute(
                    "ALTER TABLE chapters ADD COLUMN story_time_end_moment_id TEXT "
                    "REFERENCES timeline_moments(id) ON DELETE RESTRICT"
                )
            if "story_time_extra_json" not in columns:
                database.execute(
                    "ALTER TABLE chapters ADD COLUMN story_time_extra_json TEXT "
                    "NOT NULL DEFAULT '{}'"
                )
            database.execute(
                "CREATE INDEX IF NOT EXISTS chapters_story_time_start "
                "ON chapters(story_time_start_moment_id)"
            )
            database.execute(
                "CREATE INDEX IF NOT EXISTS chapters_story_time_end "
                "ON chapters(story_time_end_moment_id)"
            )
    if version < 9:
        tables = {
            row[0]
            for row in database.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('chapters','manuscript_tree_items')"
            )
        }
        if tables == {"chapters", "manuscript_tree_items"}:
            database.execute(
                """
                INSERT OR IGNORE INTO manuscript_tree_items(
                  id,parent_folder_id,kind,chapter_id,folder_id,position,extra_json
                )
                SELECT 'chapter:' || id,NULL,'chapter',id,NULL,position,'{}'
                FROM chapters
                ORDER BY position
                """
            )
    if version < 10:
        profile_tables = {
            row[0]
            for row in database.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('profiles','profile_fields')"
            )
        }
        if profile_tables == {"profiles", "profile_fields"}:
            profile_field_columns = {
                row[1] for row in database.execute("PRAGMA table_info(profile_fields)")
            }
            if not {"field_id", "extra_json"} <= profile_field_columns:
                database.execute(
                    """
                    CREATE TABLE IF NOT EXISTS profile_fields_v10 (
                      figure_id TEXT NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
                      field_id TEXT NOT NULL,
                      position INTEGER NOT NULL,
                      label TEXT NOT NULL DEFAULT '',
                      value TEXT NOT NULL DEFAULT '',
                      extra_json TEXT NOT NULL DEFAULT '{}',
                      PRIMARY KEY (figure_id, field_id),
                      UNIQUE (figure_id, position)
                    )
                    """
                )
                for profile in database.execute(
                    "SELECT figure_id,age,role,appearance,origin,voice,extra_json "
                    "FROM profiles ORDER BY rowid"
                ).fetchall():
                    figure_id = profile[0]
                    existing = database.execute(
                        "SELECT label,value FROM profile_fields "
                        "WHERE figure_id=? ORDER BY position",
                        (figure_id,),
                    ).fetchall()
                    profile_extensions: Any
                    try:
                        profile_extensions = json.loads(profile[6])
                    except (TypeError, ValueError):
                        profile_extensions = None
                    has_canonical_fields = isinstance(profile_extensions, dict) and (
                        "fields" in profile_extensions
                    )
                    canonical_fields = (
                        profile_extensions.get("fields") if has_canonical_fields else None
                    )
                    if has_canonical_fields:
                        if not isinstance(canonical_fields, list):
                            raise ValueError("invalid canonical profile fields during migration")
                        seen_ids: set[str] = set()
                        migrated = []
                        for field in canonical_fields:
                            if (
                                not isinstance(field, Mapping)
                                or not isinstance(field.get("id"), str)
                                or not field["id"]
                                or field["id"] in seen_ids
                                or not isinstance(field.get("key"), str)
                                or not isinstance(field.get("value"), str)
                            ):
                                raise ValueError("invalid canonical profile field during migration")
                            seen_ids.add(field["id"])
                            migrated.append(
                                (
                                    field["id"],
                                    field["key"],
                                    field["value"],
                                    json.dumps(
                                        {
                                            key: value
                                            for key, value in field.items()
                                            if key not in {"id", "key", "value"}
                                        },
                                        ensure_ascii=False,
                                    ),
                                )
                            )
                        del profile_extensions["fields"]
                        database.execute(
                            "UPDATE profiles SET extra_json=? WHERE figure_id=?",
                            (
                                json.dumps(profile_extensions, ensure_ascii=False),
                                figure_id,
                            ),
                        )
                    else:
                        migrated = [
                            (
                                legacy_profile_field_id(figure_id, key),
                                label,
                                profile[column_index],
                                "{}",
                            )
                            for (key, label), column_index in zip(
                                LEGACY_PROFILE_FIELDS,
                                range(1, 6),
                                strict=True,
                            )
                            if profile[column_index]
                        ]
                        migrated.extend(
                            (
                                legacy_extra_field_id(figure_id, position),
                                field[0],
                                field[1],
                                "{}",
                            )
                            for position, field in enumerate(existing)
                        )
                    database.executemany(
                        "INSERT INTO profile_fields_v10("
                        "figure_id,field_id,position,label,value,extra_json"
                        ") VALUES(?,?,?,?,?,?)",
                        [
                            (figure_id, field_id, position, label, value, extra_json)
                            for position, (field_id, label, value, extra_json) in enumerate(
                                migrated
                            )
                        ],
                    )
                database.execute("DROP TABLE profile_fields")
                database.execute("ALTER TABLE profile_fields_v10 RENAME TO profile_fields")
    if version < 11:
        storyboards_exist = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='storyboards'"
        ).fetchone()
        if storyboards_exist:
            database.execute(
                """
                INSERT INTO storyboards(id,position,title,extra_json)
                SELECT ?,0,?,'{}'
                WHERE NOT EXISTS (SELECT 1 FROM storyboards)
                """,
                (DEFAULT_STORYBOARD_ID, DEFAULT_STORYBOARD_TITLE),
            )
    if version < 12:
        # The bootstrap script already creates the table for every database it
        # opens; repeating it here keeps the step readable on its own and costs
        # nothing, and the index is what makes the unreferenced-image sweep at
        # save time a scan of dates rather than of image bytes.
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS place_map_images (
              -- The id is the lowercase SHA-256 of `data`: one row per
              -- distinct map, and a served image that may be cached forever.
              id TEXT PRIMARY KEY,
              mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
              width INTEGER NOT NULL CHECK (width > 0),
              height INTEGER NOT NULL CHECK (height > 0),
              byte_size INTEGER NOT NULL CHECK (byte_size > 0),
              created_at TEXT NOT NULL,
              data BLOB NOT NULL
            )
            """
        )
        database.execute(
            "CREATE INDEX IF NOT EXISTS place_map_images_created ON place_map_images(created_at)"
        )
    if version < 13:
        # Two manuscript settings carried German names until v3.16: `zeichenAktiv` for the
        # symbols the insert panel offers, and `elementeVerborgen` for the world elements it
        # hides. `zeichenAktiv` never reached the disk -- it was only the key this database
        # handed upwards for the `characters_json` column, so renaming it costs nothing here.
        #
        # `elementeVerborgen` did: it lives in the settings' passthrough bag. It is renamed
        # once, here, so that nothing downstream has to know two spellings. Both keys are
        # cleared out afterwards; a document that still carries one is refused by the wire
        # validator, and rightly so.
        # Like every step above: ask whether the table is there before reading it. The ladder
        # also runs against databases that carry only `meta` -- the contract test does exactly
        # that -- and a step that assumes a full schema breaks the whole chain for them.
        settings_exist = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='manuscript_settings'"
        ).fetchone()
        settings = (
            database.execute("SELECT extra_json FROM manuscript_settings WHERE id=1").fetchone()
            if settings_exist
            else None
        )
        if settings:
            try:
                extra = json.loads(settings[0])
            except (TypeError, ValueError):
                extra = None
            if isinstance(extra, dict) and (
                "elementeVerborgen" in extra or "zeichenAktiv" in extra
            ):
                hidden = extra.pop("elementeVerborgen", None)
                extra.pop("zeichenAktiv", None)
                if isinstance(hidden, list) and "hiddenElements" not in extra:
                    extra["hiddenElements"] = hidden
                database.execute(
                    "UPDATE manuscript_settings SET extra_json=? WHERE id=1",
                    (json.dumps(extra, ensure_ascii=False),),
                )
    if version < 14:
        # The last two German keys, `notizen` and `gerichtet`, never reached a column: figure
        # profiles and edges have been stored as `notes` and `directed` all along, and both keys
        # were kept out of the passthrough bags. One place did persist them, though -- the
        # assistant's own history. A proposal is stored as the raw answer it was, and a stored
        # answer outlives the spelling it was written in.
        #
        # That matters because the history is not an archive: a proposal can still be applied.
        # Under the new spelling `notizen` is simply an unknown key, so the note would vanish on
        # the way in -- silently, which is the worst way for it to happen.
        #
        # Renaming keys rather than text: `notizen` also occurs in the prose these answers cite,
        # and that prose is a value, never a key.
        history_exists = database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='assistant_interactions'"
        ).fetchone()
        rows = (
            database.execute(
                "SELECT id, response_json FROM assistant_interactions"
                " WHERE response_json IS NOT NULL"
            ).fetchall()
            if history_exists
            else []
        )
        for row in rows:
            try:
                response = json.loads(row[1])
            except (TypeError, ValueError):
                continue
            if not _rename_german_keys(response):
                continue
            database.execute(
                "UPDATE assistant_interactions SET response_json=? WHERE id=?",
                (json.dumps(response, ensure_ascii=False), row[0]),
            )
    if version < 15:
        # A reference card stops carrying a note of its own: its text is appended to the one
        # note of the chapter, figure, place or moment it shows (T-177, D-97, D-100).
        _move_reference_card_notes(database)
    database.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)",
        (str(SCHEMA_VERSION),),
    )


__all__ = ["DISCARDED_NOTES_META_KEY", "migrate"]
