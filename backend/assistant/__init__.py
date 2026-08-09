"""Local worldbuilding assistant: split across contract.py (deterministic planning
heuristics), audit.py (world/proposal validation), batch.py (broad-request batch
orchestration), and runtime.py (the stateful model runtime and its invoke pipeline).

This module re-exports the combined public surface so existing callers/tests that do
`from backend.assistant import X` keep working unchanged."""

from backend.assistant.audit import (
    audit_message,
    presence_consistency_issues,
    validate_proposals,
    validate_world,
)
from backend.assistant.batch import (
    BATCH_GROUP_TOKEN_BUDGET,
    broad_scope_message,
    estimate_batch_seconds,
)
from backend.assistant.contract import (
    BROAD_SCOPE_REQUEST,
    complete_compound_proposals,
    contract_expectations,
    existing_creation_target,
    proposal_group_title,
    required_proposal_kinds,
    structured_context,
    structured_world_state,
    task_contract,
    verify_task_contract,
)
from backend.assistant.runtime import (
    CONTEXT_SAFETY_MARGIN,
    CONVERSATION_HISTORY_TOKEN_BUDGET,
    MODEL_CONTEXT_TOKENS,
    MUTATION_REQUEST,
    PROSE_REQUEST,
    SYSTEM_PROMPT,
    AssistantRuntime,
    conversation_messages,
    finish_progress,
    read_progress,
    start_progress,
    update_progress,
)

__all__ = [
    "AssistantRuntime",
    "BATCH_GROUP_TOKEN_BUDGET",
    "BROAD_SCOPE_REQUEST",
    "CONTEXT_SAFETY_MARGIN",
    "CONVERSATION_HISTORY_TOKEN_BUDGET",
    "MODEL_CONTEXT_TOKENS",
    "MUTATION_REQUEST",
    "PROSE_REQUEST",
    "SYSTEM_PROMPT",
    "audit_message",
    "broad_scope_message",
    "complete_compound_proposals",
    "contract_expectations",
    "conversation_messages",
    "estimate_batch_seconds",
    "existing_creation_target",
    "finish_progress",
    "presence_consistency_issues",
    "proposal_group_title",
    "read_progress",
    "required_proposal_kinds",
    "start_progress",
    "structured_context",
    "structured_world_state",
    "task_contract",
    "update_progress",
    "validate_proposals",
    "validate_world",
    "verify_task_contract",
]
