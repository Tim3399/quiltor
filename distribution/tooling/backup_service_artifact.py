#!/usr/bin/env python3
"""Validate the versioned, exact-payload backup-service artifact contract."""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPO_ROOT / "services/backup-server/artifact-contract.json"
EXPECTED_PAYLOAD = frozenset(
    {
        "server.py",
        "quiltor/application/backup_manifest.py",
        "quiltor-backup-service.json",
        "VERSION",
        "LICENSE",
        "THIRD-PARTY-NOTICES.md",
    }
)
EXPECTED_SOURCES = {
    "server.py": REPO_ROOT / "services/backup-server/server.py",
    "quiltor/application/backup_manifest.py": (
        REPO_ROOT / "src/quiltor/application/backup_manifest.py"
    ),
    "quiltor-backup-service.json": CONTRACT_PATH,
    "VERSION": REPO_ROOT / "VERSION",
    "LICENSE": REPO_ROOT / "LICENSE",
    "THIRD-PARTY-NOTICES.md": REPO_ROOT / "THIRD-PARTY-NOTICES.md",
}


def load_contract(path: Path = CONTRACT_PATH) -> dict[str, object]:
    document = json.loads(path.read_text(encoding="utf-8"))
    expected_keys = {
        "schemaVersion",
        "contract",
        "contractVersion",
        "id",
        "name",
        "role",
        "entrypoint",
        "versionSource",
        "baseImage",
        "payload",
    }
    if not isinstance(document, dict) or set(document) != expected_keys:
        raise ValueError("Backup-service artifact contract fields are invalid.")
    if (
        document["schemaVersion"] != 1
        or document["contract"] != "quiltor.backup-service.artifact"
        or document["contractVersion"] != 1
        or document["id"] != "quiltor-backup-service"
        or document["role"] != "backup-service"
        or document["entrypoint"] != "server.py"
        or document["versionSource"] != "VERSION"
    ):
        raise ValueError("Backup-service artifact identity is invalid.")
    payload = document.get("payload")
    if (
        not isinstance(payload, list)
        or set(payload) != EXPECTED_PAYLOAD
        or len(payload) != len(EXPECTED_PAYLOAD)
    ):
        raise ValueError("Backup-service artifact payload is not the exact allowlist.")
    base_image = document.get("baseImage")
    if (
        not isinstance(base_image, str)
        or re.fullmatch(r"python:3\.12\.13-slim-trixie@sha256:[0-9a-f]{64}", base_image) is None
    ):
        raise ValueError("Backup-service base image is not the approved digest reference.")
    for source in EXPECTED_SOURCES.values():
        if not source.is_file():
            raise ValueError(f"Backup-service payload source is missing: {source}")
    return document


def verify_tree(root: Path, path: Path = CONTRACT_PATH) -> None:
    document = load_contract(path)
    files = {item.relative_to(root).as_posix() for item in root.rglob("*") if item.is_file()}
    expected = set(document["payload"])
    if files != expected:
        raise ValueError(
            "Backup-service payload drift "
            f"(extra={sorted(files - expected)}, missing={sorted(expected - files)})."
        )


if __name__ == "__main__":
    load_contract()
    print("valid backup-service artifact contract")
