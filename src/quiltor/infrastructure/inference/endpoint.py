"""Where the assistant's inference requests go, and with which credential.

A scaffold for T-58: today it reports exactly the behaviour the engine already
has (QUILTOR_AI_URL or the local sidecar, no key, model name "local"). The
external, key-carrying mode and its validation arrive with T-58 P5.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

DEFAULT_INFERENCE_URL = "http://127.0.0.1:11435"


@dataclass(frozen=True)
class InferenceEndpoint:
    url: str  # without a trailing slash
    api_key: str = field(default="", repr=False)  # "" when none; never in repr
    external: bool = False  # True exactly when a key is configured
    model_name: str = "local"


def resolve_endpoint(environ: Mapping[str, str] = os.environ) -> InferenceEndpoint:
    return InferenceEndpoint(
        url=environ.get("QUILTOR_AI_URL", DEFAULT_INFERENCE_URL).rstrip("/"),
        api_key="",
        external=False,
        model_name="local",
    )


__all__ = ["DEFAULT_INFERENCE_URL", "InferenceEndpoint", "resolve_endpoint"]
