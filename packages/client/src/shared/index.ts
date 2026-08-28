export {
  ENTITY_ALIAS_NORMALIZATION_V1,
  normalizeEntityAliasV1,
} from "./entityAliasNormalizationV1";
export type { ApplicationErrorCategory } from "./errors";
export type { SavePhase } from "./save";
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
  NOTE_REFERENCE_SURFACE_MAX_LENGTH,
  normalizeNoteReferenceSurface,
  worldReferenceKey,
} from "./worldReference";
export {
  LEGACY_PROFILE_FIELD_KEYS,
  LEGACY_PROFILE_FIELD_LABELS,
  type LegacyProfileFieldKey,
  type LegacyProfileFieldLabel,
  type NormalizableProfile,
  type NormalizableProfileField,
  normalizeProfile,
  normalizeProfileFields,
} from "./profileNormalization";
