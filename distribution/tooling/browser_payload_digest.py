#!/usr/bin/env python3
"""Create or verify a deterministic SHA-256 for an extracted browser payload."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SHA256 = re.compile(r"[0-9a-f]{64}")
CHUNK_SIZE = 1024 * 1024


class PayloadDigestError(ValueError):
    """The payload cannot be hashed safely or does not match its lock."""


@dataclass(frozen=True)
class BrowserPayload:
    playwright_version: str
    platform: str
    directory: str
    tree_sha256: str


def _write_header(digest: Any, kind: bytes, relative: str, mode: int, size: int) -> None:
    encoded = relative.encode("utf-8")
    digest.update(kind)
    digest.update(struct.pack(">Q", len(encoded)))
    digest.update(encoded)
    digest.update(struct.pack(">I", mode))
    digest.update(struct.pack(">Q", size))


def tree_sha256(root: Path) -> str:
    """Hash relative paths, Unix modes, link targets, and file bytes in stable order."""

    if not root.is_dir():
        raise PayloadDigestError(f"browser payload is not a directory: {root}")
    digest = hashlib.sha256()
    entries = sorted(root.rglob("*"), key=lambda path: path.relative_to(root).as_posix())
    if not entries:
        raise PayloadDigestError(f"browser payload is empty: {root}")
    for path in entries:
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        mode = stat.S_IMODE(metadata.st_mode)
        if path.is_symlink():
            target = os.readlink(path).encode("utf-8")
            _write_header(digest, b"L", relative, mode, len(target))
            digest.update(target)
        elif path.is_dir():
            _write_header(digest, b"D", relative, mode, 0)
        elif path.is_file():
            _write_header(digest, b"F", relative, mode, metadata.st_size)
            with path.open("rb") as source:
                while chunk := source.read(CHUNK_SIZE):
                    digest.update(chunk)
        else:
            raise PayloadDigestError(f"unsupported browser payload entry: {path}")
    return digest.hexdigest()


def verify(root: Path, expected: str) -> str:
    if SHA256.fullmatch(expected) is None:
        raise PayloadDigestError("expected browser payload digest must be lowercase SHA-256")
    actual = tree_sha256(root)
    if actual != expected:
        raise PayloadDigestError(
            f"browser payload digest mismatch: expected {expected}, got {actual}"
        )
    return actual


def load_contract(path: Path, platform: str) -> BrowserPayload:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PayloadDigestError(f"invalid browser payload contract {path}: {error}") from error
    if not isinstance(document, dict) or set(document) != {
        "schemaVersion",
        "playwrightVersion",
        "payloads",
    }:
        raise PayloadDigestError("browser payload contract has unexpected fields")
    if document["schemaVersion"] != 1:
        raise PayloadDigestError("browser payload contract must use schemaVersion 1")
    playwright_version = document["playwrightVersion"]
    payloads = document["payloads"]
    if not isinstance(playwright_version, str) or not re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+", playwright_version
    ):
        raise PayloadDigestError("browser payload contract has an invalid Playwright version")
    if not isinstance(payloads, dict) or set(payloads) != {"linux/amd64"}:
        raise PayloadDigestError("browser payload contract must lock exactly linux/amd64")
    record = payloads.get(platform)
    if not isinstance(record, dict) or set(record) != {"kind", "directory", "treeSha256"}:
        raise PayloadDigestError(f"browser payload contract does not lock {platform}")
    if record["kind"] != "chromium-headless-shell":
        raise PayloadDigestError("browser payload contract must lock Chromium Headless Shell")
    directory = record["directory"]
    tree_digest = record["treeSha256"]
    if (
        not isinstance(directory, str)
        or re.fullmatch(r"chromium_headless_shell-[0-9]+", directory) is None
    ):
        raise PayloadDigestError("browser payload contract has an invalid directory")
    if not isinstance(tree_digest, str) or SHA256.fullmatch(tree_digest) is None:
        raise PayloadDigestError("browser payload contract has an invalid tree SHA-256")
    return BrowserPayload(
        playwright_version=playwright_version,
        platform=platform,
        directory=directory,
        tree_sha256=tree_digest,
    )


def verify_contract(root: Path, contract_path: Path, platform: str, playwright_version: str) -> str:
    payload = load_contract(contract_path, platform)
    if payload.playwright_version != playwright_version:
        raise PayloadDigestError(
            "browser payload contract and installed Playwright version disagree"
        )
    return verify(root / payload.directory, payload.tree_sha256)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("digest", "check", "check-contract"))
    parser.add_argument("root", type=Path)
    parser.add_argument("expected", nargs="?")
    parser.add_argument("--contract", type=Path)
    parser.add_argument("--platform")
    parser.add_argument("--playwright-version")
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "digest":
            if arguments.expected is not None:
                parser.error("digest does not accept an expected hash")
            result = tree_sha256(arguments.root)
        elif arguments.command == "check":
            if arguments.expected is None:
                parser.error("check requires an expected hash")
            result = verify(arguments.root, arguments.expected)
        else:
            if arguments.expected is not None:
                parser.error("check-contract does not accept an expected hash")
            if (
                arguments.contract is None
                or arguments.platform is None
                or arguments.playwright_version is None
            ):
                parser.error(
                    "check-contract requires --contract, --platform, and --playwright-version"
                )
            result = verify_contract(
                arguments.root,
                arguments.contract,
                arguments.platform,
                arguments.playwright_version,
            )
    except PayloadDigestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
