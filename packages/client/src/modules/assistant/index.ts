export { applyAssistantProposals } from "./proposals";
export type {
  AssistantClaimStatus,
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

export const loadAssistantDrawer = () =>
  import("./AssistantDrawer").then(({ AssistantDrawer }) => ({ default: AssistantDrawer }));
