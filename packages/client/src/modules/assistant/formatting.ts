import type { Translate } from "../../i18n";
import type { AssistantReply } from "./model";

// Deterministic replies carry translation keys and optional translated message items.
// Literal `message` remains the fallback for free-form model output.
export function resolveAssistantMessage(reply: AssistantReply, t: Translate): string {
  const base = reply.messageKey
    ? t(reply.messageKey, {
        ...reply.messageParams,
        ...(reply.messageItems
          ? { items: reply.messageItems.map((item) => t(item.key, item.params)).join("; ") }
          : {}),
      })
    : reply.message;
  return reply.messageNoteKey ? `${base}\n\n${t(reply.messageNoteKey)}` : base;
}

export function replyReferences(reply: AssistantReply): string[] {
  const targets = (reply.proposals || []).flatMap((proposal) => {
    if (proposal.kind === "create_element" || proposal.kind === "create_timeline_moment")
      return [proposal.tempId];
    if (proposal.kind === "update_element" || proposal.kind === "mark_deceased")
      return [proposal.elementId];
    if (proposal.kind === "set_presence")
      return [
        proposal.elementId,
        proposal.placeId,
        ...(proposal.momentId ? [proposal.momentId] : []),
      ];
    if (proposal.kind === "create_relationship")
      return [proposal.relationship.from, proposal.relationship.to];
    if (proposal.kind === "set_relationship_at_moment")
      return [proposal.relationshipId, proposal.momentId];
    return [];
  });
  return [...new Set([...(reply.sources || []).map((source) => source.id), ...targets])];
}
