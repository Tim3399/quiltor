export type {
  NoteReference,
  WorldReferenceBacklink,
  WorldReferenceBacklinkIndex,
  WorldReferenceBacklinkSource,
  WorldReferenceBacklinkSourceKind,
  StoryboardReferenceSource,
  WorldReferenceCandidate,
  WorldReferenceTarget,
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
