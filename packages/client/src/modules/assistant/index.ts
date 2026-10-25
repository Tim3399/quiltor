export type {
  AssistantContextClass,
  AssistantHistoryMessage,
  AssistantJobState,
  AssistantJobStatus,
  AssistantMessageItem,
  AssistantMode,
  AssistantProposal,
  AssistantProposalEnvelope,
  AssistantReply,
  AssistantSource,
} from "./model";
export { applyAssistantProposalsWithResult } from "./proposals";

export const loadAssistantDrawer = () =>
  import("./AssistantDrawer").then(({ AssistantDrawer }) => ({ default: AssistantDrawer }));
