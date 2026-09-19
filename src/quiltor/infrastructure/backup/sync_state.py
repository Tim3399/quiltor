"""Small atomic store for synchronization baselines and in-flight CAS retries."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

_FORMAT = 1
_MAX_BYTES = 64 * 1024


class JsonSyncStateStore:
    def __init__(self, root: Path | Callable[[], Path]) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root() if callable(self._root) else self._root

    @staticmethod
    def _key(world_id: str, endpoint: str, account_id: str) -> str:
        identity = json.dumps(
            [world_id, endpoint, account_id], ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(identity).hexdigest()

    def _path(self, world_id: str, endpoint: str, account_id: str) -> Path:
        return self.root / f"{self._key(world_id, endpoint, account_id)}.json"

    def load(self, world_id: str, endpoint: str, account_id: str) -> dict[str, Any] | None:
        path = self._path(world_id, endpoint, account_id)
        try:
            payload = path.read_bytes()
            if len(payload) > _MAX_BYTES:
                return None
            document = json.loads(payload)
        except (OSError, UnicodeError, ValueError):
            return None
        if not isinstance(document, dict) or document.get("format") != _FORMAT:
            return None
        if document.get("worldId") != world_id:
            return None
        if document.get("endpoint") != endpoint or document.get("accountId") != account_id:
            return None
        state = document.get("state")
        return state if isinstance(state, dict) else None

    def save(self, world_id: str, endpoint: str, account_id: str, state: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        target = self._path(world_id, endpoint, account_id)
        document = {
            "format": _FORMAT,
            "worldId": world_id,
            "endpoint": endpoint,
            "accountId": account_id,
            "state": state,
        }
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.root, prefix=".sync-", delete=False
        ) as handle:
            json.dump(document, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
            staged = Path(handle.name)
        try:
            staged.replace(target)
            # POSIX requires syncing the directory entry as well as the file for
            # rename durability. Python's standard library cannot open a Windows
            # directory for fsync; os.replace remains atomic there, but the host
            # filesystem decides when that directory metadata reaches storage.
            try:
                directory_fd = os.open(self.root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            except PermissionError:
                # Windows does not expose a directory handle usable by os.fsync.
                directory_fd = None
            if directory_fd is not None:
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            staged.unlink(missing_ok=True)


__all__ = ["JsonSyncStateStore"]
