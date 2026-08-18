"""Shared limits for Quiltor's bundled local inference runtimes."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RuntimeConfig:
    context_tokens: int = 8192
    template_reserve: int = 256
    minimum_output_tokens: int = 300
    base_output_tokens: int = 900
    output_tokens_per_kind: int = 150
    history_tokens: int = 2000
    forced_context_tokens: int = 5692
    token_cache_bytes: int = 4 * 1024 * 1024


RUNTIME_CONFIG = RuntimeConfig()
