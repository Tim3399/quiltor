export type {
  NoteReference,
  StoryboardReferenceSource,
  WorldReferenceBacklink,
  WorldReferenceBacklinkIndex,
  WorldReferenceBacklinkSource,
  WorldReferenceBacklinkSourceKind,
  WorldReferenceCandidate,
  WorldReferenceCardBacklink,
  WorldReferenceTarget,
  WorldReferenceTextBacklink,
} from "./model";
export { worldReferenceKey } from "./model";
export {
  backlinksForWorldReference,
  buildWorldReferenceBacklinks,
  workspaceTargetForBacklink,
} from "./worldReferenceBacklinks";
export {
  buildWorldReferenceCandidates,
  resolveWorldReferenceCandidate,
  searchWorldReferences,
  type WorldReferenceIndexLabels,
  workspaceTargetForReference,
} from "./worldReferenceIndex";
