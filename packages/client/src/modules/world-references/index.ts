export type {
  NoteReference,
  StoryboardReferenceSource,
  WorldReferenceCandidate,
  WorldReferenceTarget,
} from "./model";
export { worldReferenceKey } from "./model";
export {
  buildWorldReferenceCandidates,
  resolveWorldReferenceCandidate,
  searchWorldReferences,
  type WorldReferenceIndexLabels,
  workspaceTargetForReference,
} from "./worldReferenceIndex";
