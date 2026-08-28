import type { MessageKey } from "../../../i18n";
import type { LegacyProfileFieldKey } from "../profile";

export const PROFILE_FIELD_TEMPLATES = [
  { legacyKey: "alter", label: "profileAge" },
  { legacyKey: "rolle", label: "profileRoleInStory" },
  { legacyKey: "aussehen", label: "profileAppearance" },
  { legacyKey: "herkunft", label: "profileBackground" },
  { legacyKey: "stimme", label: "profileVoice" },
] as const satisfies ReadonlyArray<{ legacyKey: LegacyProfileFieldKey; label: MessageKey }>;
