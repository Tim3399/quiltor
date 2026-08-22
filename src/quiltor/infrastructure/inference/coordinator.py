"""Instance-owned background installation state."""

from __future__ import annotations

import threading
from typing import Callable


Progress = Callable[[str, int], None]
InstallOperation = Callable[[Progress], None]


class InstallationCoordinator:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._execution_lock = threading.Lock()
        self._state: dict[str, object] = {
            "running": False,
            "phase": "",
            "percent": 0,
            "error": "",
        }

    def start(self, operation: InstallOperation) -> bool:
        with self._lock:
            if self._state["running"]:
                return False
            self._state.update(running=True, phase="", percent=0, error="")

        def progress(phase: str, percent: int) -> None:
            with self._lock:
                self._state.update(phase=phase, percent=percent)

        def run() -> None:
            try:
                with self._execution_lock:
                    operation(progress)
                with self._lock:
                    self._state.update(running=False, phase="", percent=100, error="")
            except (SystemExit, Exception) as error:
                with self._lock:
                    self._state.update(running=False, error=str(error))

        threading.Thread(target=run, daemon=True).start()
        return True

    def read(self) -> dict[str, object]:
        with self._lock:
            return dict(self._state)


__all__ = ["InstallationCoordinator"]
