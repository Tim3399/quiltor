"""Versioned native operations exposed to the desktop WebView.

The page sees one method, :meth:`NativeBridge.invoke`. Every call uses the
``host.native-bridge`` v1 request/response envelope registered under
``contracts/native-bridge``. Keeping the envelope at this boundary lets future
desktop capabilities evolve without publishing arbitrary Python objects or
method signatures to JavaScript.
"""

from __future__ import annotations

import base64
import binascii
from pathlib import Path
from typing import Any, Callable, TypeVar

from quiltor.application.capabilities import Feature, FeatureAvailability

BRIDGE_VERSION = 1
INVOKE = "invoke"
FILE_SAVE = "file.save"
BASE64 = "base64"

_MAX_REQUEST_ID_LENGTH = 128
_MAX_FILE_NAME_LENGTH = 255
_MAX_CONTENT_LENGTH = 140_000_000
_INVALID_REQUEST_ID = "invalid-request"
_REQUEST_FIELDS = {"version", "id", "operation", "payload"}
_FILE_SAVE_FIELDS = {"name", "content", "encoding"}

_Method = TypeVar("_Method", bound=Callable[..., Any])


def _internal(method: _Method) -> _Method:
    """Keep host plumbing out of ``window.pywebview.api``."""
    method._serializable = False  # type: ignore[attr-defined]
    return method


def _request_id(request: Any) -> str:
    if type(request) is dict:
        candidate = request.get("id")
        if isinstance(candidate, str) and 0 < len(candidate) <= _MAX_REQUEST_ID_LENGTH:
            return candidate
    return _INVALID_REQUEST_ID


def _success(request_id: str, result: dict[str, Any]) -> dict[str, Any]:
    return {"version": BRIDGE_VERSION, "id": request_id, "ok": True, "result": result}


def _failure(
    request_id: str,
    code: str,
    *,
    params: dict[str, Any] | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "retryable": retryable}
    if params:
        error["params"] = params
    return {"version": BRIDGE_VERSION, "id": request_id, "ok": False, "error": error}


def default_directory() -> Path:
    """Start the save dialog in Downloads, falling back to the home directory."""
    downloads = Path.home() / "Downloads"
    return downloads if downloads.is_dir() else Path.home()


class NativeBridge:
    """Strict v1 dispatcher used as pywebview's ``js_api`` object."""

    def __init__(
        self,
        capabilities: FeatureAvailability,
        directory: Path | None = None,
    ) -> None:
        self._window: Any = None
        self._capabilities = capabilities
        self._directory = Path(directory) if directory is not None else default_directory()

    @_internal
    def attach(self, window: Any) -> None:
        """Attach the window created with this bridge as its ``js_api``."""
        self._window = window

    @_internal
    def choose_path(self, name: str) -> str | None:
        """Show the native save panel and return the selected path."""
        import webview

        dialogs = getattr(webview, "FileDialog", None)
        chosen = self._window.create_file_dialog(
            dialogs.SAVE if dialogs is not None else 30,
            directory=str(self._directory),
            save_filename=name,
        )
        if not chosen:
            return None
        return chosen if isinstance(chosen, str) else chosen[0]

    def invoke(self, request: Any) -> dict[str, Any]:
        """Dispatch one contract envelope and always return a structured response."""
        request_id = _request_id(request)
        try:
            if type(request) is not dict or set(request) != _REQUEST_FIELDS:
                return _failure(request_id, "native_bridge.invalid_request")

            version = request.get("version")
            if not isinstance(version, int) or isinstance(version, bool):
                return _failure(request_id, "native_bridge.invalid_request")
            if version != BRIDGE_VERSION:
                return _failure(
                    request_id,
                    "native_bridge.unsupported_version",
                    params={"supported": BRIDGE_VERSION},
                )
            if request_id == _INVALID_REQUEST_ID:
                return _failure(request_id, "native_bridge.invalid_request")

            operation = request.get("operation")
            if operation != FILE_SAVE:
                return _failure(
                    request_id,
                    "native_bridge.unsupported_operation",
                    params={"operation": operation}
                    if isinstance(operation, str) and 0 < len(operation) <= 128
                    else None,
                )
            return self._save_file(request_id, request.get("payload"))
        except Exception:  # noqa: BLE001 -- no Python exception may cross into JavaScript
            return _failure(request_id, "native_bridge.internal_error", retryable=True)

    def _save_file(self, request_id: str, payload: Any) -> dict[str, Any]:
        if not self._capabilities.is_available(Feature.ARBITRARY_FILE_ACCESS):
            return _failure(request_id, "native_bridge.capability_unavailable")
        if type(payload) is not dict or set(payload) != _FILE_SAVE_FIELDS:
            return _failure(request_id, "file.invalid_payload")

        name = payload.get("name")
        content = payload.get("content")
        encoding = payload.get("encoding")
        if (
            not isinstance(name, str)
            or not 0 < len(name) <= _MAX_FILE_NAME_LENGTH
            or any(character in name for character in ("/", "\\", "\0"))
            or not isinstance(content, str)
            or len(content) > _MAX_CONTENT_LENGTH
            or encoding != BASE64
        ):
            return _failure(request_id, "file.invalid_payload")
        if self._window is None:
            return _failure(request_id, "native_bridge.not_ready", retryable=True)

        try:
            data = base64.b64decode(content, validate=True)
        except (binascii.Error, ValueError):
            return _failure(request_id, "file.decode_failed")

        try:
            target = self.choose_path(name)
        except Exception:  # noqa: BLE001 -- native dialog failures stay inside the host
            return _failure(request_id, "file.dialog_failed", retryable=True)
        if not target:
            return _success(request_id, {"status": "cancelled"})

        if not isinstance(target, str):
            return _failure(request_id, "file.dialog_failed", retryable=True)

        try:
            path = Path(target)
            path.write_bytes(data)
        except (OSError, TypeError, ValueError):
            return _failure(request_id, "file.write_failed", retryable=True)

        self._directory = path.parent
        return _success(request_id, {"status": "saved"})
