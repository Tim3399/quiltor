export type {
  NoteReference,
  WorldReferenceBacklink,
  WorldReferenceBacklinkIndex,
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
  workspaceTargetForReference,
} from "./worldReferenceIndex";
