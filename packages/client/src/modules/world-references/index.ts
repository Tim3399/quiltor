export type {
  NoteReference,
  StoryboardReferenceSource,
  WorldReferenceCandidate,
  WorldReferenceTarget,
} from "./model";
export { worldReferenceKey } from "./model";
export {
  buildWorldReferenceCandidates,
  searchWorldReferences,
  workspaceTargetForReference,
  type WorldReferenceIndexLabels,
} from "./worldReferenceIndex";
