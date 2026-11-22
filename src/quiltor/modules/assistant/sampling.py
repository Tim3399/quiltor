"""Sampling overrides for the evaluation runner, never for the product (T-289, D-213).

The server reads `QUILTOR_EVAL` and `QUILTOR_EVAL_SAMPLING` once at startup and hands the
result down as a value; nothing in this package reads the environment. Without the switch
there is no `EvalSampling` at all and every payload keeps its fixed product values.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

# The largest seed every engine accepts: llama.cpp, MLX and WebLLM all take a 32-bit value.
MAX_SEED = 2**31 - 1


@dataclass(frozen=True, slots=True)
class EvalSampling:
    """What an evaluation run fixes; a field left None keeps the product value."""

    temperature: float | None = None
    seed: int | None = None
    max_tokens: int | None = None

    def with_seed(self, seed: int) -> EvalSampling:
        return replace(self, seed=seed)

    def wire(self) -> dict[str, Any]:
        """The form stored with a job, so the worker computes it with the same values."""
        return {"temperature": self.temperature, "seed": self.seed, "maxTokens": self.max_tokens}

    @classmethod
    def from_wire(cls, value: Any) -> EvalSampling | None:
        if not isinstance(value, dict):
            return None
        return cls(
            temperature=value.get("temperature"),
            seed=value.get("seed"),
            max_tokens=value.get("maxTokens"),
        )


def is_seed(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_SEED


def apply_sampling(
    payload: dict[str, Any], sampling: EvalSampling | None, *, max_tokens_ceiling: int
) -> dict[str, Any]:
    """Overlay `sampling` on one engine payload in place and return it.

    `max_tokens` never exceeds the ceiling the caller computed (the context headroom, or
    the planner's 500). Without a seed the key stays absent: MLX and WebLLM ask whether it
    is present, not whether it is None.
    """

    if sampling is None:
        return payload
    if sampling.temperature is not None:
        payload["temperature"] = sampling.temperature
    if sampling.max_tokens is not None:
        payload["max_tokens"] = min(sampling.max_tokens, max_tokens_ceiling)
    if sampling.seed is not None:
        payload["seed"] = sampling.seed
    return payload


__all__ = ["MAX_SEED", "EvalSampling", "apply_sampling", "is_seed"]
