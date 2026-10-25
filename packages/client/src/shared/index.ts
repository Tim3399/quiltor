export {
  ENTITY_ALIAS_NORMALIZATION_V1,
  normalizeEntityAliasV1,
} from "./entityAliasNormalizationV1";
export type { ApplicationErrorCategory } from "./errors";
export { GRAPH_EDGE_COLORS, type GraphEdgeColor } from "./graphEdgeColor";
export {
  GRAPH_EDGE_LINE_STYLES,
  GRAPH_RELATIONSHIP_KINDS,
  type GraphEdgeLineStyle,
  type GraphRelationshipKind,
} from "./graphEdgeLineStyle";
export {
  cloneNoteMarks,
  type NoteHeadingLevel,
  type NoteMark,
} from "./noteMark";
export {
  LEGACY_PROFILE_FIELD_KEYS,
  type LegacyProfileFieldKey,
  normalizeProfile,
  normalizeProfileFields,
} from "./profileNormalization";
export { relativeTime } from "./relativeTime";
export type { SavePhase } from "./save";
export { shortcut } from "./shortcut";
export type { Theme, ThemePreference } from "./theme";
export type {
  TextSearchTarget,
  ViewportMode,
  Workspace,
  WorkspaceLayout,
  WorkspaceTarget,
} from "./workspace";
export type { NoteReference, WorldReferenceTarget } from "./worldReference";
export {
  normalizeNoteReferenceSurface,
  worldReferenceKey,
} from "./worldReference";
