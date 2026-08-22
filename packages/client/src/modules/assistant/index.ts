export { applyAssistantProposals } from "./proposals";
export type {
  AssistantHistoryMessage,
  AssistantJobState,
  AssistantJobStatus,
  AssistantMessageItem,
  AssistantProposal,
  AssistantReply,
  AssistantSource,
} from "./model";

export const loadAssistantDrawer = () =>
  import("./AssistantDrawer").then(({ AssistantDrawer }) => ({ default: AssistantDrawer }));
