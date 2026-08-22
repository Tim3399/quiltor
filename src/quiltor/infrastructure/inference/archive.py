"""Portable safe extraction for the pinned inference runtime archive."""

from __future__ import annotations

import shutil
import stat
import tarfile
import zipfile
from pathlib import Path

from quiltor.infrastructure.inference.install_manifest import safe_relative_path


MAX_ARCHIVE_FILES = 20_000
MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024


def _destination(root: Path, name: str, *, directory: bool = False) -> Path:
    selected = name[:-1] if directory and name.endswith("/") else name
    relative = safe_relative_path(selected)
    base = root.resolve(strict=False)
    target = root.joinpath(*relative.parts).resolve(strict=False)
    try:
        target.relative_to(base)
    except ValueError as exc:  # defensive: safe_relative_path already rejects aliases
        raise ValueError("Archive member escapes the extraction directory.") from exc
    return target


def _copy_bounded(source, target: Path, declared_size: int) -> None:
    if declared_size < 0 or declared_size > MAX_EXTRACTED_BYTES:
        raise ValueError("Archive member exceeds the extraction limit.")
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with target.open("xb") as destination:
        while chunk := source.read(1024 * 1024):
            written += len(chunk)
            if written > declared_size or written > MAX_EXTRACTED_BYTES:
                raise ValueError("Archive member size does not match its declaration.")
            destination.write(chunk)
    if written != declared_size:
        target.unlink(missing_ok=True)
        raise ValueError("Archive member size does not match its declaration.")


def _extract_zip(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if len(members) > MAX_ARCHIVE_FILES:
            raise ValueError("Archive contains too many files.")
        if sum(member.file_size for member in members) > MAX_EXTRACTED_BYTES:
            raise ValueError("Archive expands beyond the configured limit.")
        for member in members:
            target = _destination(destination, member.filename, directory=member.is_dir())
            mode = (member.external_attr >> 16) & 0o170000
            allowed_types = {0, stat.S_IFDIR} if member.is_dir() else {0, stat.S_IFREG}
            if mode not in allowed_types or member.flag_bits & 0x1:
                raise ValueError("Archive links and encrypted members are not supported.")
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            with bundle.open(member, "r") as source:
                _copy_bounded(source, target, member.file_size)


def _extract_tar(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > MAX_ARCHIVE_FILES:
            raise ValueError("Archive contains too many files.")
        if sum(member.size for member in members if member.isfile()) > MAX_EXTRACTED_BYTES:
            raise ValueError("Archive expands beyond the configured limit.")
        for member in members:
            target = _destination(destination, member.name, directory=member.isdir())
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise ValueError("Archive links and special files are not supported.")
            source = bundle.extractfile(member)
            if source is None:
                raise ValueError("Archive member could not be read.")
            with source:
                _copy_bounded(source, target, member.size)


def extract_archive(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError("Archive destination must be empty.")
    if archive.suffix == ".zip":
        _extract_zip(archive, destination)
    elif archive.name.endswith(".tar.gz"):
        _extract_tar(archive, destination)
    else:
        raise ValueError(f"Unsupported archive type: {archive.name}")


def locate_expected_files(destination: Path, expected_files: tuple[str, ...]) -> dict[str, Path]:
    """Resolve each manifest-owned leaf exactly once after safe extraction."""

    found: dict[str, Path] = {}
    for filename in expected_files:
        matches = [
            candidate
            for candidate in destination.rglob(filename)
            if candidate.is_file() and not candidate.is_symlink()
        ]
        if len(matches) != 1:
            raise ValueError(f"Archive must contain exactly one expected file named {filename!r}.")
        found[filename] = matches[0]
    return found


__all__ = ["extract_archive", "locate_expected_files"]
