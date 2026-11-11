"""Instance-owned background installation state."""

from __future__ import annotations

import threading
from collections.abc import Callable

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
            # A stable name for failures the interface explains in its own words;
            # empty for everything else, which is shown as the raw message.
            "errorCode": "",
        }

    def start(self, operation: InstallOperation) -> bool:
        with self._lock:
            if self._state["running"]:
                return False
            self._state.update(running=True, phase="", percent=0, error="", errorCode="")

        def progress(phase: str, percent: int) -> None:
            with self._lock:
                self._state.update(phase=phase, percent=percent)

        def run() -> None:
            try:
                with self._execution_lock:
                    operation(progress)
                with self._lock:
                    self._state.update(running=False, phase="", percent=100, error="", errorCode="")
            except (SystemExit, Exception) as error:  # noqa: BLE001 - any install failure is reported in the job state
                # The console keeps the full message -- for a changed download
                # host the interface names no host, so this is where it stays.
                print(f"Assistant setup failed: {error}", flush=True)
                with self._lock:
                    self._state.update(
                        running=False,
                        error=str(error),
                        errorCode=str(getattr(error, "error_code", "") or ""),
                    )

        threading.Thread(target=run, daemon=True).start()
        return True

    def read(self) -> dict[str, object]:
        with self._lock:
            return dict(self._state)


__all__ = ["InstallationCoordinator"]
