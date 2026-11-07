"""Where the assistant's inference requests go, and with which credential (T-58 P5).

Two modes, decided by one fact -- whether an API key is configured:

- **Local** (no key): exactly as before. QUILTOR_AI_URL, or the sidecar Quiltor starts itself,
  speaking the llama.cpp contract with /health and /tokenize.
- **External** (QUILTOR_AI_KEY or QUILTOR_AI_KEY_FILE): an OpenAI-compatible provider at
  QUILTOR_AI_URL. No sidecar starts, every request carries the key as a bearer token, and the
  URL must be HTTPS -- or plain http to this machine only -- so the key never crosses a network
  in the clear.

Every validation error is a RuntimeError in English that names the variable, never its value.
"""

from __future__ import annotations

import os
import urllib.parse
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_INFERENCE_URL = "http://127.0.0.1:11435"
DEFAULT_MODEL_NAME = "local"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
MAX_KEY_LENGTH = 4096
MAX_MODEL_NAME_LENGTH = 200


@dataclass(frozen=True)
class InferenceEndpoint:
    url: str  # without a trailing slash
    api_key: str = field(default="", repr=False)  # "" when none; never in repr
    external: bool = False  # True exactly when a key is configured
    model_name: str = DEFAULT_MODEL_NAME


def _has_control_characters(value: str) -> bool:
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def _read_key(environ: Mapping[str, str]) -> str:
    inline = environ.get("QUILTOR_AI_KEY", "")
    key_file = environ.get("QUILTOR_AI_KEY_FILE", "")
    if inline and key_file:
        raise RuntimeError("Set QUILTOR_AI_KEY or QUILTOR_AI_KEY_FILE, not both.")
    if key_file:
        path = Path(key_file)
        try:
            if path.stat().st_size > MAX_KEY_LENGTH:
                raise RuntimeError("QUILTOR_AI_KEY_FILE is larger than 4096 bytes.")
            key = path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeDecodeError) as exc:
            raise RuntimeError("QUILTOR_AI_KEY_FILE cannot be read.") from exc
        if not key:
            raise RuntimeError("QUILTOR_AI_KEY_FILE is empty.")
    else:
        key = inline
    if len(key) > MAX_KEY_LENGTH:
        raise RuntimeError("QUILTOR_AI_KEY is longer than 4096 characters.")
    if _has_control_characters(key):
        raise RuntimeError("QUILTOR_AI_KEY contains control characters.")
    return key


def _validate_external_url(url: str) -> None:
    parts = urllib.parse.urlsplit(url)
    secure = parts.scheme == "https" or (
        parts.scheme == "http" and (parts.hostname or "") in LOOPBACK_HOSTS
    )
    if not secure or not parts.hostname:
        raise RuntimeError(
            "QUILTOR_AI_URL must be HTTPS (or loopback) when an API key is configured."
        )
    # Userinfo would put a second credential into every log line and status that shows the URL;
    # a query or fragment would be glued in front of /v1/... and silently change the path.
    if parts.username is not None or parts.password is not None:
        raise RuntimeError("QUILTOR_AI_URL must not contain user information.")
    if parts.query or parts.fragment:
        raise RuntimeError("QUILTOR_AI_URL must not contain a query or fragment.")


def _model_name(environ: Mapping[str, str]) -> str:
    if "QUILTOR_AI_MODEL_NAME" not in environ:
        return DEFAULT_MODEL_NAME
    name = environ["QUILTOR_AI_MODEL_NAME"].strip()
    if not name or len(name) > MAX_MODEL_NAME_LENGTH:
        raise RuntimeError("QUILTOR_AI_MODEL_NAME must be between 1 and 200 characters.")
    return name


def resolve_endpoint(environ: Mapping[str, str] = os.environ) -> InferenceEndpoint:
    key = _read_key(environ)
    model_name = _model_name(environ)
    if not key:
        return InferenceEndpoint(
            url=environ.get("QUILTOR_AI_URL", DEFAULT_INFERENCE_URL).rstrip("/"),
            model_name=model_name,
        )
    # Without a URL the key would go to the default address -- the local sidecar's port, where
    # any process could be listening to collect it (F-58-4).
    url = environ.get("QUILTOR_AI_URL", "").strip()
    if not url:
        raise RuntimeError("QUILTOR_AI_KEY requires QUILTOR_AI_URL.")
    _validate_external_url(url)
    return InferenceEndpoint(url=url.rstrip("/"), api_key=key, external=True, model_name=model_name)


__all__ = ["DEFAULT_INFERENCE_URL", "InferenceEndpoint", "resolve_endpoint"]
