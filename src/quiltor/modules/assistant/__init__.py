"""Local worldbuilding assistant with explicit product-policy ownership.

This module re-exports the combined public surface so existing callers/tests that do
`from quiltor.modules.assistant import X` keep working unchanged."""

from quiltor.modules.assistant.audit import (
    audit_message,
    audit_reply,
    presence_consistency_issues,
    validate_proposals,
    validate_world,
)
from quiltor.modules.assistant.batch import (
    BATCH_GROUP_TOKEN_BUDGET,
    batch_summary_reply,
    broad_scope_message,
    broad_scope_reply,
    estimate_batch_seconds,
)
from quiltor.modules.assistant.contract import (
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
from quiltor.modules.assistant.conversation import (
    CONVERSATION_HISTORY_TOKEN_BUDGET,
    conversation_messages,
)
from quiltor.modules.assistant.prompts import (
    ASSISTANT_REPLY_LANGUAGES,
    CONTEXT_SAFETY_MARGIN,
    DEFAULT_ASSISTANT_LANGUAGE,
    MODEL_CONTEXT_TOKENS,
    MUTATION_REQUEST,
    PROSE_REQUEST,
    SYSTEM_PROMPT,
    system_prompt,
)
from quiltor.modules.assistant.runtime import AssistantRuntime

__all__ = [
    "ASSISTANT_REPLY_LANGUAGES",
    "AssistantRuntime",
    "BATCH_GROUP_TOKEN_BUDGET",
    "BROAD_SCOPE_REQUEST",
    "CONTEXT_SAFETY_MARGIN",
    "CONVERSATION_HISTORY_TOKEN_BUDGET",
    "DEFAULT_ASSISTANT_LANGUAGE",
    "MODEL_CONTEXT_TOKENS",
    "MUTATION_REQUEST",
    "PROSE_REQUEST",
    "SYSTEM_PROMPT",
    "audit_message",
    "audit_reply",
    "batch_summary_reply",
    "broad_scope_message",
    "broad_scope_reply",
    "complete_compound_proposals",
    "contract_expectations",
    "conversation_messages",
    "estimate_batch_seconds",
    "existing_creation_target",
    "presence_consistency_issues",
    "proposal_group_title",
    "required_proposal_kinds",
    "structured_context",
    "structured_world_state",
    "system_prompt",
    "task_contract",
    "validate_proposals",
    "validate_world",
    "verify_task_contract",
]
