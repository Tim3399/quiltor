from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import uuid
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from quiltor.application.document_wire_v1 import (
    InvalidDocumentWireV1,
    decode_document_v1,
    encode_document_v1,
)
from quiltor.application.project_transfer import (
    MAX_ARCHIVE_BYTES,
    InvalidProjectArchive,
    InvalidProjectAsset,
    ProjectArchiveLimitExceeded,
    ProjectPublicationFailed,
    ProjectTransferPreview,
    UnsupportedProjectArchive,
)
from quiltor.application.worlds import WorldSummary
from quiltor.domain.manuscript import story_time_anchor_issue
from quiltor.domain.story_world.place_map_image import MAX_IMAGE_BYTES, UnsupportedImage, identify
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.sqlite import (
    manuscript,
    place_map_images,
    schema,
    story_world,
    storyboards,
    world_catalog,
)
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths
from quiltor.infrastructure.persistence.sqlite.connection import connection

MAX_EXPANDED_BYTES = 128 * 1024 * 1024
MAX_MEMBERS = 256
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
_IMAGE_NAME = re.compile(r"images/([0-9a-f]{64})\.(png|jpg|webp)")
_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


@dataclass(frozen=True, slots=True)
class ValidatedArchive:
    title: str
    manuscript: dict[str, Any]
    figures: dict[str, Any]
    storyboards: dict[str, Any]
    images: dict[str, bytes]
    descriptors: list[dict[str, Any]]

    def preview(self) -> ProjectTransferPreview:
        chapters = self.manuscript.get("chapters", [])
        return ProjectTransferPreview(
            title=self.title,
            chapters=len(chapters),
            book_chapters=sum(chapter.get("inBook", True) is not False for chapter in chapters),
            set_aside_chapters=sum(chapter.get("inBook", True) is False for chapter in chapters),
            trashed_chapters=len(self.manuscript.get("trash", [])),
            figures=len(self.figures.get("nodes", [])),
            storyboards=len(self.storyboards.get("boards", [])),
            images=len(self.images),
        )


class SQLiteProjectTransferRepository:
    def __init__(self, paths: SQLitePaths) -> None:
        self.paths = paths
        self.worlds = SQLiteWorldRepository(paths)

    def export(self, world_id: str, owner_sub: str) -> tuple[str, bytes]:
        opened = self.worlds.open(world_id, owner_sub)
        database = opened.paths.documents.database
        documents = {
            "manuscript": encode_document_v1("manuscript", manuscript.load(database)),
            "figures": encode_document_v1("figures", story_world.load(database)),
            "storyboards": encode_document_v1("storyboards", storyboards.load(database)),
        }
        issue = story_time_anchor_issue(
            documents["manuscript"]["payload"], documents["figures"]["payload"]
        )
        if issue is not None:
            raise InvalidProjectArchive(
                "Persisted project contains invalid story-time anchors.",
                params={"reason": issue.reason},
            )
        referenced = _referenced_images(documents["figures"]["payload"])
        catalog = {image.id: image for image in place_map_images.catalog(database)}
        descriptors: list[dict[str, Any]] = []
        blobs: dict[str, bytes] = {}
        for image_id in sorted(referenced):
            metadata = catalog.get(image_id)
            content = place_map_images.content(image_id, database)
            if metadata is None or content is None:
                raise InvalidProjectAsset("A referenced place map image is missing.")
            actual = _validate_image(content.data, image_id)
            if (
                metadata.mime != actual.mime
                or metadata.width != actual.width
                or metadata.height != actual.height
                or metadata.byte_size != len(content.data)
            ):
                raise InvalidProjectAsset("Stored place map metadata does not match its bytes.")
            member = f"images/{image_id}.{_EXTENSIONS[actual.mime]}"
            descriptors.append(
                {
                    "id": image_id,
                    "member": member,
                    "mime": actual.mime,
                    "width": actual.width,
                    "height": actual.height,
                    "byteSize": len(content.data),
                }
            )
            blobs[member] = content.data
        manifest = {
            "format": "quiltor-project",
            "version": 1,
            "title": opened.summary.title,
            "exportedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "includes": {"trash": True, "history": False},
            "documents": documents,
            "images": descriptors,
        }
        manifest_bytes = json.dumps(
            manifest, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        if len(manifest_bytes) > MAX_MANIFEST_BYTES:
            raise ProjectArchiveLimitExceeded("Project manifest exceeds the transfer limit.")
        if len(descriptors) > MAX_MEMBERS - 1:
            raise ProjectArchiveLimitExceeded("Project archive contains too many members.")
        if len(manifest_bytes) + sum(len(blob) for blob in blobs.values()) > MAX_EXPANDED_BYTES:
            raise ProjectArchiveLimitExceeded("Expanded project archive is too large.")
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", manifest_bytes)
            for member, payload in blobs.items():
                archive.writestr(member, payload)
        result = target.getvalue()
        if len(result) > MAX_ARCHIVE_BYTES:
            raise ProjectArchiveLimitExceeded("Project archive exceeds the transfer limit.")
        return opened.summary.title, result

    def preview(self, archive: bytes) -> ProjectTransferPreview:
        return validate_archive(archive).preview()

    def import_archive(self, archive: bytes, owner_sub: str) -> WorldSummary:
        validated = validate_archive(archive)
        self.paths.worlds.mkdir(parents=True, exist_ok=True)
        world_id = uuid.uuid4().hex
        final = world_catalog.world_db_path(world_id, paths=self.paths)
        staged = self.paths.worlds / f".{world_id}.importing.sqlite3"
        try:
            schema.initialize(staged)
            story_world.save(validated.figures, db_path=staged)
            manuscript.save(validated.manuscript, db_path=staged)
            storyboards.save(validated.storyboards, db_path=staged)
            for descriptor in validated.descriptors:
                place_map_images.store(
                    validated.images[descriptor["id"]],
                    _validate_image(validated.images[descriptor["id"]], descriptor["id"]),
                    db_path=staged,
                )
            with connection(staged) as database:
                database.execute(
                    "INSERT OR REPLACE INTO meta(key,value) VALUES('world_title',?)",
                    (validated.title,),
                )
                database.execute(
                    "INSERT OR REPLACE INTO meta(key,value) VALUES('owner_sub',?)",
                    (owner_sub,),
                )
                database.execute("DELETE FROM meta WHERE key='backup_endpoint'")
                database.execute("DELETE FROM meta WHERE key='deleted_at'")
            _verify_staged(staged)
            with connection(staged) as database:
                database.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            os.replace(staged, final)
        except (InvalidProjectArchive, InvalidProjectAsset):
            raise
        except Exception as error:
            raise ProjectPublicationFailed("Could not publish the imported project.") from error
        finally:
            for candidate in (Path(f"{staged}-wal"), Path(f"{staged}-shm"), staged):
                candidate.unlink(missing_ok=True)
        return WorldSummary(
            id=world_id,
            title=validated.title,
            backup_url="",
            updated=datetime.now(UTC).isoformat(),
        )


def validate_archive(payload: bytes) -> ValidatedArchive:
    if not payload or len(payload) > MAX_ARCHIVE_BYTES:
        raise ProjectArchiveLimitExceeded("Project archive size is outside the accepted limit.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except (zipfile.BadZipFile, OSError) as error:
        raise InvalidProjectArchive("Project archive is not a readable ZIP file.") from error
    with archive:
        members = archive.infolist()
        if not members or len(members) > MAX_MEMBERS:
            raise ProjectArchiveLimitExceeded("Project archive contains too many members.")
        names = [member.filename for member in members]
        if len(names) != len(set(names)):
            raise InvalidProjectArchive("Project archive contains duplicate members.")
        expanded = 0
        for member in members:
            if member.flag_bits & 0x1:
                raise InvalidProjectArchive("Encrypted project archives are not supported.")
            if not _safe_member(member.filename) or member.is_dir():
                raise InvalidProjectArchive("Project archive contains an unsafe member name.")
            expanded += member.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise ProjectArchiveLimitExceeded("Expanded project archive is too large.")
        if "manifest.json" not in names:
            raise InvalidProjectArchive("Project archive has no manifest.")
        manifest_info = archive.getinfo("manifest.json")
        if manifest_info.file_size > MAX_MANIFEST_BYTES:
            raise ProjectArchiveLimitExceeded("Project manifest is too large.")
        try:
            manifest_payload = archive.read(manifest_info)
        except (zipfile.BadZipFile, NotImplementedError, RuntimeError) as error:
            raise InvalidProjectArchive("Project manifest cannot be read.") from error
        manifest = _strict_json(manifest_payload)
        try:
            validated = _validate_manifest(manifest)
        except RecursionError as error:
            raise InvalidProjectArchive("Project manifest is nested too deeply.") from error
        declared_members = {descriptor["member"] for descriptor in validated["descriptors"]}
        if set(names) != {"manifest.json", *declared_members}:
            raise InvalidProjectArchive("Project archive contains unexpected or missing members.")
        images: dict[str, bytes] = {}
        for descriptor in validated["descriptors"]:
            info = archive.getinfo(descriptor["member"])
            if info.file_size > MAX_IMAGE_BYTES:
                raise ProjectArchiveLimitExceeded("A project image exceeds the image limit.")
            try:
                data = archive.read(info)
            except (zipfile.BadZipFile, NotImplementedError, RuntimeError) as error:
                raise InvalidProjectAsset("Project image cannot be read.") from error
            if len(data) != info.file_size or len(data) != descriptor["byteSize"]:
                raise InvalidProjectAsset("Project image size does not match its descriptor.")
            actual = _validate_image(data, descriptor["id"])
            if (
                actual.mime != descriptor["mime"]
                or actual.width != descriptor["width"]
                or actual.height != descriptor["height"]
            ):
                raise InvalidProjectAsset("Project image metadata does not match its bytes.")
            images[descriptor["id"]] = data
        referenced = _referenced_images(validated["figures"])
        if referenced != set(images):
            raise InvalidProjectAsset("Referenced project images are missing or undeclared.")
        return ValidatedArchive(
            title=validated["title"],
            manuscript=validated["manuscript"],
            figures=validated["figures"],
            storyboards=validated["storyboards"],
            images=images,
            descriptors=validated["descriptors"],
        )


def _validate_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "format",
        "version",
        "title",
        "exportedAt",
        "includes",
        "documents",
        "images",
    }:
        raise InvalidProjectArchive("Project manifest fields are invalid.")
    if value["format"] != "quiltor-project" or type(value["version"]) is not int:
        raise UnsupportedProjectArchive("Project archive version is not supported.")
    if value["version"] != 1:
        raise UnsupportedProjectArchive("Project archive version is not supported.")
    title = value["title"]
    if not isinstance(title, str) or not title.strip() or len(title) > 100:
        raise InvalidProjectArchive("Project title is invalid.")
    exported_at = value["exportedAt"]
    if not isinstance(exported_at, str) or not exported_at.endswith("Z"):
        raise InvalidProjectArchive("Project export timestamp is invalid.")
    try:
        parsed_exported_at = datetime.fromisoformat(exported_at.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise InvalidProjectArchive("Project export timestamp is invalid.") from error
    if parsed_exported_at.tzinfo is None:
        raise InvalidProjectArchive("Project export timestamp is invalid.")
    includes = value["includes"]
    if (
        not isinstance(includes, dict)
        or set(includes) != {"trash", "history"}
        or type(includes["trash"]) is not bool
        or type(includes["history"]) is not bool
        or not includes["trash"]
        or includes["history"]
    ):
        raise InvalidProjectArchive("Project inclusion contract is invalid.")
    documents = value["documents"]
    if not isinstance(documents, dict) or set(documents) != {
        "manuscript",
        "figures",
        "storyboards",
    }:
        raise InvalidProjectArchive("Project documents are incomplete.")
    decoded: dict[str, dict[str, Any]] = {}
    try:
        for kind in ("manuscript", "figures", "storyboards"):
            if isinstance(documents[kind], dict) and "revision" in documents[kind]:
                raise InvalidProjectArchive("Transferred documents must not contain revisions.")
            decoded[kind] = decode_document_v1(kind, documents[kind]).payload
    except InvalidDocumentWireV1 as error:
        raise InvalidProjectArchive("A transferred document is invalid.") from error
    issue = story_time_anchor_issue(decoded["manuscript"], decoded["figures"])
    if issue is not None:
        raise InvalidProjectArchive(
            "Project story-time anchors are invalid.", params={"reason": issue.reason}
        )
    raw_images = value["images"]
    if not isinstance(raw_images, list) or len(raw_images) > MAX_MEMBERS - 1:
        raise ProjectArchiveLimitExceeded("Project image catalog is too large.")
    descriptors: list[dict[str, Any]] = []
    ids: set[str] = set()
    members: set[str] = set()
    for descriptor in raw_images:
        if not isinstance(descriptor, dict) or set(descriptor) != {
            "id",
            "member",
            "mime",
            "width",
            "height",
            "byteSize",
        }:
            raise InvalidProjectAsset("Project image descriptor is invalid.")
        image_id = descriptor["id"]
        member = descriptor["member"]
        mime = descriptor["mime"]
        match = _IMAGE_NAME.fullmatch(member) if isinstance(member, str) else None
        if (
            not isinstance(image_id, str)
            or not re.fullmatch(r"[0-9a-f]{64}", image_id)
            or match is None
            or match.group(1) != image_id
            or not isinstance(mime, str)
            or mime not in _EXTENSIONS
            or match.group(2) != _EXTENSIONS[mime]
            or type(descriptor["width"]) is not int
            or type(descriptor["height"]) is not int
            or type(descriptor["byteSize"]) is not int
            or descriptor["width"] <= 0
            or descriptor["height"] <= 0
            or not 0 < descriptor["byteSize"] <= MAX_IMAGE_BYTES
            or image_id in ids
            or member in members
        ):
            raise InvalidProjectAsset("Project image descriptor is invalid.")
        ids.add(image_id)
        members.add(member)
        descriptors.append(descriptor)
    return {
        "title": title.strip(),
        "manuscript": decoded["manuscript"],
        "figures": decoded["figures"],
        "storyboards": decoded["storyboards"],
        "descriptors": descriptors,
    }


def _strict_json(payload: bytes) -> Any:
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise InvalidProjectArchive("Project manifest contains duplicate JSON keys.")
            result[key] = value
        return result

    def constant(_value):
        raise InvalidProjectArchive("Project manifest contains a non-finite number.")

    def finite_float(value: str) -> float:
        parsed = float(value)
        if not math.isfinite(parsed):
            raise InvalidProjectArchive("Project manifest contains a non-finite number.")
        return parsed

    try:
        return json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=pairs,
            parse_constant=constant,
            parse_float=finite_float,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise InvalidProjectArchive("Project manifest is not valid UTF-8 JSON.") from error


def _safe_member(name: str) -> bool:
    if not name or "\\" in name or name.startswith("/"):
        return False
    path = PurePosixPath(name)
    return not path.is_absolute() and all(part not in {"", ".", ".."} for part in path.parts)


def _validate_image(payload: bytes, expected_id: str):
    if hashlib.sha256(payload).hexdigest() != expected_id:
        raise InvalidProjectAsset("Project image checksum does not match its id.")
    try:
        return identify(payload)
    except UnsupportedImage as error:
        raise InvalidProjectAsset("Project image content is unsupported.") from error


def _referenced_images(value: Any) -> set[str]:
    result: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "mapImageId" and isinstance(child, str) and child:
                result.add(child)
            else:
                result.update(_referenced_images(child))
    elif isinstance(value, list):
        for child in value:
            result.update(_referenced_images(child))
    return result


def _verify_staged(database: Path) -> None:
    loaded_manuscript = manuscript.load(database)
    loaded_figures = story_world.load(database)
    encode_document_v1("manuscript", loaded_manuscript)
    encode_document_v1("figures", loaded_figures)
    encode_document_v1("storyboards", storyboards.load(database))
    if story_time_anchor_issue(loaded_manuscript, loaded_figures) is not None:
        raise InvalidProjectArchive("Imported project failed story-time validation.")


__all__ = [
    "MAX_ARCHIVE_BYTES",
    "MAX_EXPANDED_BYTES",
    "MAX_MANIFEST_BYTES",
    "MAX_MEMBERS",
    "SQLiteProjectTransferRepository",
    "validate_archive",
]
