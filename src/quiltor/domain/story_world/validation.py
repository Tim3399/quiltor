# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from typing import TypeGuard

from quiltor.domain.json_values import JsonObject, as_array, as_object
from quiltor.domain.manuscript.story_time import valid_story_time_reference
from quiltor.domain.manuscript.tree import ManuscriptTreeError, structure_or_flat
from quiltor.domain.notes import valid_note_marks
from quiltor.domain.story_world.entity_resolution import normalize_entity_name
from quiltor.domain.text_offsets import utf16_length, utf16_offsets_to_indices

MAX_SAFE_INTEGER = 9_007_199_254_740_991
NOTE_REFERENCE_KINDS = {"entity", "place", "timeline", "chapter", "storyboard"}
LEGACY_PROFILE_KEYS = ("alter", "rolle", "aussehen", "herkunft", "stimme")


def _is_number(value: object) -> TypeGuard[int | float]:
    """An int or float, but not a bool, which Python counts as an int."""

    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _valid_note_references(owner: Mapping[str, object], note_key: str) -> bool:
    """Validate stable targets over exact, non-overlapping UTF-16 note ranges."""
    references = as_array(owner.get("noteReferences", []))
    note = owner.get(note_key, "")
    if not isinstance(note, str) or references is None or len(references) > 10_000:
        return False
    rows: list[tuple[int, int, JsonObject]] = []
    offsets: list[int] = []
    for item in references:
        reference = as_object(item)
        if reference is None:
            return False
        start, end = reference.get("from"), reference.get("to")
        if type(start) is not int or type(end) is not int or start < 0 or end <= start:
            return False
        rows.append((start, end, reference))
        offsets.extend((start, end))
    indices = utf16_offsets_to_indices(note, offsets)
    if indices is None:
        return False
    ids: set[str] = set()
    previous_to = -1
    for start, end, reference in sorted(rows, key=lambda row: row[0]):
        reference_id = reference.get("id")
        target = as_object(reference.get("target"))
        kind = target.get("kind") if target is not None else None
        target_id = target.get("id") if target is not None else None
        surface = reference.get("surface")
        if (
            not isinstance(reference_id, str)
            or not reference_id
            or utf16_length(reference_id) > 500
            or reference_id in ids
            or not isinstance(kind, str)
            or kind not in NOTE_REFERENCE_KINDS
            or not isinstance(target_id, str)
            or not target_id
            or not isinstance(surface, str)
            or not surface
            or utf16_length(surface) > 1000
        ):
            return False
        if start < previous_to or note[indices[start] : indices[end]] != surface:
            return False
        ids.add(reference_id)
        previous_to = end
    return True


def _valid_extra_field(value: object) -> bool:
    field = as_object(value)
    return field is not None and isinstance(field.get("k"), str) and isinstance(field.get("v"), str)


def _valid_profile(value: object) -> bool:
    profile = as_object(value)
    if (
        profile is None
        or not _valid_note_references(profile, "notes")
        or not valid_note_marks(profile, "notes")
    ):
        return False
    if any(
        key in profile and not isinstance(profile[key], str)
        for key in (*LEGACY_PROFILE_KEYS, "notes")
    ):
        return False
    if "extra" in profile:
        extras = as_array(profile["extra"])
        if extras is None or not all(_valid_extra_field(field) for field in extras):
            return False
    if "fields" not in profile:
        return True
    fields = as_array(profile["fields"])
    if fields is None:
        return False
    field_ids: list[str] = []
    for item in fields:
        field = as_object(item)
        field_id = field.get("id") if field is not None else None
        if (
            field is None
            or not isinstance(field_id, str)
            or not field_id
            or not isinstance(field.get("key"), str)
            or not isinstance(field.get("value"), str)
        ):
            return False
        field_ids.append(field_id)
    return len(field_ids) == len(set(field_ids))


def _valid_place_level(node: JsonObject) -> bool:
    """Where a place sits on the level above it, and how it is drawn there."""

    for key in ("parentPlaceId", "mapImageId"):
        value = node.get(key)
        if value is not None and (not isinstance(value, str) or not value):
            return False
    for key in ("mapU", "mapV", "mapImageU", "mapImageV"):
        value = node.get(key)
        if value is not None and (not _is_number(value) or not 0 <= value <= 1):
            return False
    zoom = node.get("mapImageZoom")
    if zoom is not None and (not _is_number(zoom) or not 1 <= zoom <= 8):
        return False
    expanded = node.get("mapExpanded")
    if expanded is not None and type(expanded) is not bool:
        return False
    display = node.get("placeDisplay")
    if "placeDisplay" in node and (not isinstance(display, str) or display not in {"card", "pin"}):
        return False
    for key in ("mapWidth", "mapHeight"):
        value = node.get(key)
        if value is not None and (not _is_number(value) or value <= 0):
            return False
    scale = node.get("mapScale")
    return not (scale is not None and not _valid_map_scale(scale))


def _valid_map_scale(value: object) -> bool:
    scale = as_object(value)
    if scale is None:
        return False
    units = scale.get("unitsPer100px")
    return _is_number(units) and units > 0 and isinstance(scale.get("unitLabel"), str)


def _acyclic_place_levels(nodes: list[JsonObject]) -> bool:
    """Containment has to reach a root; a loop would make a trail run forever."""

    # Keyed by unvalidated ids: the node checks run after this one.
    kinds: dict[object, object] = {node.get("id"): node.get("type", "person") for node in nodes}
    parents: dict[object, object] = {}
    for node in nodes:
        parent = node.get("parentPlaceId")
        if parent is None:
            continue
        if kinds.get(node.get("id")) != "ort" or kinds.get(parent) != "ort":
            return False
        parents[node.get("id")] = parent
    for start in parents:
        seen = {start}
        current = parents.get(start)
        while current is not None:
            if current in seen:
                return False
            seen.add(current)
            current = parents.get(current)
    return True


def _objects(values: list[object]) -> list[JsonObject] | None:
    """Every item as an object, or None if one of them is not."""

    rows: list[JsonObject] = []
    for value in values:
        row = as_object(value)
        if row is None:
            return None
        rows.append(row)
    return rows


def _valid_aliases(value: object) -> bool:
    aliases = as_array(value)
    if aliases is None:
        return False
    normalized_aliases: list[str] = []
    for item in aliases:
        alias = as_object(item)
        text = alias.get("alias") if alias is not None else None
        if (
            alias is None
            or not isinstance(text, str)
            or not normalize_entity_name(text)
            or alias.get("source", "manual") not in {"manual", "manuscript", "assistant", "import"}
        ):
            return False
        normalized_aliases.append(normalize_entity_name(text))
    return len(normalized_aliases) == len(set(normalized_aliases))


def _valid_moment(moment: JsonObject) -> bool:
    if (
        not isinstance(moment.get("title", ""), str)
        or not isinstance(moment.get("date", ""), str)
        or not isinstance(moment.get("note", ""), str)
        or not _valid_note_references(moment, "note")
        or not valid_note_marks(moment, "note")
    ):
        return False
    start: int | None = None
    if "time" in moment:
        time = moment["time"]
        if type(time) is not int or abs(time) > MAX_SAFE_INTEGER:
            return False
        start = time
    if "position" in moment and type(moment["position"]) is not int:
        return False
    if moment.get("precision", "day") not in {"day", "month", "year"}:
        return False
    if "endTime" in moment:
        end = moment["endTime"]
        if (
            type(end) is not int
            or abs(end) > MAX_SAFE_INTEGER
            or end < (end if start is None else start)
        ):
            return False
    return not (
        "endPrecision" in moment
        and ("endTime" not in moment or moment["endPrecision"] not in {"day", "month", "year"})
    )


EDGE_STYLES = {"solid", "dashed", "blood", "gold"}
EDGE_COLORS = {"auto", "ink", "gold", "rose", "moss", "blue"}
EDGE_LINE_STYLES = {"solid", "dashed", "dotted"}
RELATIONSHIP_KINDS = {"general", "kinship"}


def _valid_edge_look(row: JsonObject) -> bool:
    """Style, colour, line style and relationship kind, shared by an edge and its versions."""

    for key, default, allowed in (
        ("style", "solid", EDGE_STYLES),
        ("color", "auto", EDGE_COLORS),
        ("lineStyle", "solid", EDGE_LINE_STYLES),
        ("relationshipKind", "general", RELATIONSHIP_KINDS),
    ):
        value = row.get(key, default)
        if not isinstance(value, str) or value not in allowed:
            return False
    return True


def _valid_versions(value: object, known: set[str], known_moments: set[str]) -> bool:
    versions = as_array(value)
    if versions is None:
        return False
    version_moments: list[object] = []
    for item in versions:
        version = as_object(item)
        if (
            version is None
            or version.get("momentId") not in known_moments
            or type(version.get("active")) is not bool
            or ("from" in version and version["from"] not in known)
            or ("to" in version and version["to"] not in known)
            or ("label" in version and not isinstance(version["label"], str))
            or ("directed" in version and type(version["directed"]) is not bool)
            or not _valid_edge_look(version)
        ):
            return False
        version_moments.append(version["momentId"])
    return len(version_moments) == len(set(version_moments))


def valid_figures(payload: object) -> bool:
    document = as_object(payload)
    raw_nodes = as_array(document.get("nodes")) if document is not None else None
    raw_edges = as_array(document.get("edges")) if document is not None else None
    if document is None or raw_nodes is None or raw_edges is None:
        return False
    if "timeSystem" in document and not _valid_time_system(document["timeSystem"]):
        return False
    nodes = _objects(raw_nodes)
    if nodes is None or not _acyclic_place_levels(nodes):
        return False
    ids: list[str] = []
    # Keyed by node id, but looked up with unvalidated JSON values (a missing placeId).
    kinds: dict[object, object] = {}
    for node in nodes:
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            return False
        if (
            not isinstance(node.get("name"), str)
            or not isinstance(node.get("x"), (int, float))
            or not isinstance(node.get("y"), (int, float))
        ):
            return False
        if node.get("mapX") is not None and not isinstance(node.get("mapX"), (int, float)):
            return False
        if node.get("mapY") is not None and not isinstance(node.get("mapY"), (int, float)):
            return False
        if not _valid_place_level(node):
            return False
        ids.append(node_id)
        kinds[node_id] = node.get("type", "person")
        if "profile" in node and not _valid_profile(node["profile"]):
            return False
        if "aliases" in node and not _valid_aliases(node["aliases"]):
            return False
    if len(ids) != len(set(ids)):
        return False

    timeline = as_array(document.get("timeline", []))
    if timeline is None:
        return False
    moment_ids: list[str] = []
    for item in timeline:
        moment = as_object(item)
        moment_id = moment.get("id") if moment is not None else None
        if (
            moment is None
            or not isinstance(moment_id, str)
            or not moment_id
            or not _valid_moment(moment)
        ):
            return False
        moment_ids.append(moment_id)
    if len(moment_ids) != len(set(moment_ids)):
        return False

    known, known_moments = set(ids), set(moment_ids)
    death_moments = [node["diedMomentId"] for node in nodes if "diedMomentId" in node]
    if any(
        not isinstance(moment_id, str) or not moment_id or moment_id not in known_moments
        for moment_id in death_moments
    ):
        return False
    edge_ids: list[str] = []
    for item in raw_edges:
        edge = as_object(item)
        edge_id = edge.get("id") if edge is not None else None
        if (
            edge is None
            or not isinstance(edge_id, str)
            or not edge_id
            or edge.get("from") not in known
            or edge.get("to") not in known
            or not _valid_edge_look(edge)
        ):
            return False
        if not _valid_versions(edge.get("versions", []), known, known_moments):
            return False
        edge_ids.append(edge_id)
    if len(edge_ids) != len(set(edge_ids)):
        return False
    if "presence" not in document:
        return True
    presence = as_array(document["presence"])
    if presence is None:
        return False
    entry_ids: list[str] = []
    logical_presence: list[tuple[object, object]] = []
    for item in presence:
        entry = as_object(item)
        entry_id = entry.get("id") if entry is not None else None
        if entry is None or not isinstance(entry_id, str) or not entry_id:
            return False
        if entry.get("elementId") not in known or kinds.get(entry.get("placeId")) != "ort":
            return False
        moment_id = entry.get("momentId")
        if "momentId" in entry and (
            not isinstance(moment_id, str) or not moment_id or moment_id not in known_moments
        ):
            return False
        entry_ids.append(entry_id)
        logical_presence.append((entry["elementId"], moment_id))
    return len(entry_ids) == len(set(entry_ids)) and len(logical_presence) == len(
        set(logical_presence)
    )


def _valid_time_system(raw: object) -> bool:
    value = as_object(raw)
    if value is None:
        return False
    system_id = value.get("id")
    if (
        not isinstance(system_id, str)
        or not system_id
        or not isinstance(value.get("name"), str)
        or value.get("kind") not in {"relative", "gregorian", "custom"}
        or value.get("unit", "day") not in {"day", "abstract"}
        or (value.get("kind") != "relative" and value.get("unit", "day") != "day")
    ):
        return False
    if any(
        not isinstance(value.get(field, ""), str)
        for field in ("eraName", "eraAbbreviation", "displayFormat")
    ):
        return False
    numbers: dict[str, int] = {}
    for field, default in (
        ("epochTime", 0),
        ("epochYear", 1),
        ("epochMonth", 1),
        ("epochDay", 1),
        ("epochWeekday", 0),
    ):
        number = value.get(field, default)
        if type(number) is not int or abs(number) > MAX_SAFE_INTEGER:
            return False
        numbers[field] = number
    months, weekdays = as_array(value.get("months", [])), as_array(value.get("weekdays", []))
    if months is None or weekdays is None:
        return False
    if value.get("kind") == "custom" and not months:
        return False
    day_counts: list[int] = []
    for item in months:
        month = as_object(item)
        day_count = month.get("dayCount") if month is not None else None
        if (
            month is None
            or not isinstance(month.get("name"), str)
            or not isinstance(month.get("shortName", ""), str)
            or type(day_count) is not int
            or day_count <= 0
            or day_count > MAX_SAFE_INTEGER
        ):
            return False
        day_counts.append(day_count)
    for item in weekdays:
        weekday = as_object(item)
        if (
            weekday is None
            or not isinstance(weekday.get("name"), str)
            or not isinstance(weekday.get("shortName", ""), str)
        ):
            return False
    epoch_weekday = numbers["epochWeekday"]
    if weekdays and not 0 <= epoch_weekday < len(weekdays):
        return False
    year, month, day = numbers["epochYear"], numbers["epochMonth"], numbers["epochDay"]
    if value.get("kind") == "gregorian":
        try:
            date(year, month, day)
        except ValueError:
            return False
    elif value.get("kind") == "custom" and (
        month < 1 or month > len(day_counts) or day < 1 or day > day_counts[month - 1]
    ):
        return False
    return True


def _valid_word(value: object) -> bool:
    if isinstance(value, str):
        return True
    word = as_object(value)
    return (
        word is not None
        and isinstance(word.get("w"), str)
        and ("d" not in word or isinstance(word["d"], str))
    )


def _texts(row: JsonObject, keys: tuple[str, ...], limit: int) -> dict[str, str] | None:
    """The non-empty strings under `keys`, at most `limit` long, or None if one is not."""

    texts: dict[str, str] = {}
    for key in keys:
        value = row.get(key)
        if not isinstance(value, str) or not value or len(value) > limit:
            return None
        texts[key] = value
    return texts


def _valid_mentions(raw: object, body: str) -> bool:
    mentions = as_array(raw)
    if mentions is None or len(mentions) > 10_000:
        return False
    rows: list[tuple[int, int, JsonObject]] = []
    offsets: list[int] = []
    for item in mentions:
        mention = as_object(item)
        if mention is None:
            return False
        start, end = mention.get("from"), mention.get("to")
        if type(start) is not int or type(end) is not int or start < 0 or end <= start:
            return False
        rows.append((start, end, mention))
        offsets.extend((start, end))
    indices = utf16_offsets_to_indices(body, offsets)
    if indices is None:
        return False
    previous_to = -1
    mention_ids: set[str] = set()
    for start, end, mention in sorted(rows, key=lambda row: row[0]):
        texts = _texts(mention, ("id", "elementId", "surface", "source"), 500)
        if texts is None:
            return False
        if texts["source"] not in {"completion", "helper", "deterministic", "llm-assisted"}:
            return False
        confidence = mention.get("confidence")
        if not _is_number(confidence) or confidence < 0 or confidence > 1:
            return False
        if (
            start < previous_to
            or body[indices[start] : indices[end]] != texts["surface"]
            or texts["id"] in mention_ids
        ):
            return False
        previous_to = end
        mention_ids.add(texts["id"])
    return True


def _valid_chapter(chapter: JsonObject) -> bool:
    title, body, note = chapter.get("title", ""), chapter.get("body", ""), chapter.get("note", "")
    if not isinstance(title, str) or not isinstance(body, str) or not isinstance(note, str):
        return False
    if "inBook" in chapter and type(chapter["inBook"]) is not bool:
        return False
    chapter_id = chapter.get("id")
    if (
        not isinstance(chapter_id, str)
        or len(chapter_id) > 200
        or len(title) > 1000
        or len(note) > 100_000
        or len(body) > 10_000_000
    ):
        return False
    if "storyTime" in chapter and not valid_story_time_reference(chapter["storyTime"]):
        return False
    if not _valid_note_references(chapter, "note"):
        return False
    if not valid_note_marks(chapter, "note"):
        return False
    if not _valid_mentions(chapter.get("mentions", []), body):
        return False
    return _valid_marks(chapter, body)


def _valid_trash_entry(entry: JsonObject, live_ids: list[str], trash_ids: set[str]) -> bool:
    chapter = as_object(entry.get("chapter"))
    if chapter is None or not valid_manuscript({"chapters": [chapter]}):
        return False
    chapter_id = chapter.get("id")
    if not isinstance(chapter_id, str) or chapter_id in live_ids or chapter_id in trash_ids:
        return False
    trash_ids.add(chapter_id)
    deleted_at = entry.get("deletedAt")
    if not isinstance(deleted_at, str) or not deleted_at.endswith("Z"):
        return False
    try:
        datetime.fromisoformat(deleted_at.removesuffix("Z") + "+00:00")
    except ValueError:
        return False
    tree_item = as_object(entry.get("treeItem"))
    if tree_item is None:
        return False
    item_id, position = tree_item.get("id"), tree_item.get("position")
    original_parent = tree_item.get("parentFolderId")
    if (
        tree_item.get("kind") != "chapter"
        or tree_item.get("chapterId") != chapter_id
        or not isinstance(item_id, str)
        or not item_id
        or len(item_id) > 500
        or type(position) is not int
        or not 0 <= position <= MAX_SAFE_INTEGER
        or "folderId" in tree_item
        or (
            "parentFolderId" in tree_item
            and (
                not isinstance(original_parent, str)
                or not original_parent
                or len(original_parent) > 200
            )
        )
    ):
        return False
    folder_path = as_array(entry.get("originalFolderPath"))
    if folder_path is None or len(folder_path) > 100:
        return False
    folder_ids: list[str] = []
    for item in folder_path:
        folder = as_object(item)
        folder_id = folder.get("id") if folder is not None else None
        folder_title = folder.get("title") if folder is not None else None
        if (
            not isinstance(folder_id, str)
            or not folder_id
            or len(folder_id) > 200
            or folder_id in folder_ids
            or not isinstance(folder_title, str)
            or len(folder_title) > 1000
        ):
            return False
        folder_ids.append(folder_id)
    return not (
        (original_parent is None and folder_ids)
        or (original_parent is not None and (not folder_ids or folder_ids[-1] != original_parent))
    )


def valid_manuscript(payload: object) -> bool:
    document = as_object(payload)
    chapters = as_array(document.get("chapters")) if document is not None else None
    if document is None or chapters is None:
        return False
    if document.get("language", "de-DE") != "de-DE" or document.get(
        "grammarMode", "manual"
    ) not in {
        "manual",
        "automatic",
    }:
        return False
    if "words" in document:
        words = as_array(document["words"])
        if words is None or not all(_valid_word(word) for word in words):
            return False
    if "activeSymbols" in document:
        symbols = as_array(document["activeSymbols"])
        if symbols is None or any(not isinstance(item, str) for item in symbols):
            return False
    ids: list[str] = []
    for item in chapters:
        chapter = as_object(item)
        chapter_id = chapter.get("id") if chapter is not None else None
        if chapter is None or not isinstance(chapter_id, str) or not chapter_id:
            return False
        if not _valid_chapter(chapter):
            return False
        ids.append(chapter_id)
    if len(ids) != len(set(ids)):
        return False
    trash = as_array(document.get("trash", []))
    if trash is None or len(trash) > 1000:
        return False
    trash_ids: set[str] = set()
    for item in trash:
        entry = as_object(item)
        if entry is None or not _valid_trash_entry(entry, ids, trash_ids):
            return False
    try:
        structure_or_flat(ids, document.get("structure"))
    except ManuscriptTreeError:
        return False
    return True


def _valid_marks(chapter: JsonObject, body: str) -> bool:
    """Bold and italic are ranges over the body, exactly like a mention -- and held to the
    same standard: inside the text, in order, and never overlapping their own kind (the
    editor merges those into one range). Bold over italic is fine, they are separate kinds."""
    marks = as_array(chapter.get("marks", []))
    if marks is None or len(marks) > 10_000:
        return False
    rows: list[tuple[int, int, str]] = []
    offsets: list[int] = []
    for item in marks:
        mark = as_object(item)
        kind = mark.get("kind") if mark is not None else None
        if mark is None or not isinstance(kind, str) or kind not in {"bold", "italic"}:
            return False
        start, end = mark.get("from"), mark.get("to")
        if type(start) is not int or type(end) is not int or start < 0 or end <= start:
            return False
        rows.append((start, end, kind))
        offsets.extend((start, end))
    if utf16_offsets_to_indices(body, offsets) is None:
        return False
    previous_to: dict[str, int] = {}
    for start, end, kind in sorted(rows, key=lambda row: row[0]):
        if start < previous_to.get(kind, -1):
            return False
        previous_to[kind] = end
    return True
