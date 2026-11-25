"""The context window, divided into one budget per prompt part (T-307).

Every engine shares one window (RUNTIME_CONFIG.context_tokens). Before this module the prompt was
fitted without the read-tool instructions and without room for a tool round, so a world of
sixteen elements could leave the model no room to answer. The parts are measured with the
engine's own counter; what is left over -- ``free`` -- goes to the world state and the RAG
excerpts by one rule (``world_target``), and a tool round is reserved in advance.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from quiltor.modules.assistant.config import RUNTIME_CONFIG

# The world state may take this share of the free tokens before RAG gets the rest, and never
# more than WORLD_CAP_MAX. For world extraction the roles swap: RAG (the manuscript) first.
WORLD_SHARE = 0.65
WORLD_CAP_MAX = 3000
# Reserved for the results of the first read round; the step message itself is counted with its
# real length when the round is appended (tool_loop).
ROUND_RESERVE = 1024
# A world-extraction part answers without read tools (T-369): no tool instructions, no read
# round, and room for EXTRACTION_PART_PROPOSALS proposals instead of the plain base output.
EXTRACTION_PART_PROPOSALS = 8
EXTRACTION_ANSWER_TOKENS = 1100
# A further read round starts only with at least this many tokens left for its results.
ROUND_MINIMUM = 512
# RAG keeps at least this much whenever there are candidates; part of the floor.
RAG_FLOOR = 256


@dataclass(frozen=True)
class PromptBudget:
    """The fixed parts of one model call and the tokens left for world state and RAG."""

    context: int
    template: int
    answer: int
    base_prompt: int
    tools: int
    round_reserve: int

    @property
    def fixed(self) -> int:
        return self.template + self.answer + self.base_prompt + self.tools + self.round_reserve

    @property
    def free(self) -> int:
        return self.context - self.fixed

    @property
    def cap(self) -> int:
        return max(0, min(int(WORLD_SHARE * self.free), WORLD_CAP_MAX))

    def trace(self) -> dict[str, object]:
        return {"step": "budget", **asdict(self), "fixed": self.fixed, "free": self.free}


def answer_tokens(required_kinds: int) -> int:
    """The answer reserve: the base output plus room for every required proposal kind."""
    return RUNTIME_CONFIG.base_output_tokens + RUNTIME_CONFIG.output_tokens_per_kind * max(
        0, required_kinds
    )


def prompt_budget(
    *, base_prompt: int, tools: int, required_kinds: int, answer_only: bool = False
) -> PromptBudget:
    """``base_prompt`` is the whole prompt with an empty world state and no RAG excerpts --
    system prompt, conversation, framing, contract and request -- measured by the engine."""
    return PromptBudget(
        context=RUNTIME_CONFIG.context_tokens,
        template=RUNTIME_CONFIG.template_reserve,
        answer=EXTRACTION_ANSWER_TOKENS if answer_only else answer_tokens(required_kinds),
        base_prompt=base_prompt,
        tools=0 if answer_only else tools,
        round_reserve=0 if answer_only else ROUND_RESERVE,
    )


def output_headroom(prompt_tokens: int) -> int:
    """What the window leaves for output after a prompt of ``prompt_tokens``."""
    return RUNTIME_CONFIG.context_tokens - prompt_tokens - RUNTIME_CONFIG.template_reserve


__all__ = [
    "EXTRACTION_ANSWER_TOKENS",
    "EXTRACTION_PART_PROPOSALS",
    "RAG_FLOOR",
    "ROUND_MINIMUM",
    "ROUND_RESERVE",
    "WORLD_CAP_MAX",
    "WORLD_SHARE",
    "PromptBudget",
    "answer_tokens",
    "output_headroom",
    "prompt_budget",
]
