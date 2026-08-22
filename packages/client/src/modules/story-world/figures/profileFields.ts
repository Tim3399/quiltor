import type { MessageKey } from "../../../i18n";
import type { Profile } from "../model";

export const PROFILE_FIELDS: Array<[keyof Profile, MessageKey, "short" | "long"]> = [
  ["alter", "profileAge", "short"],
  ["rolle", "profileRoleInStory", "long"],
  ["aussehen", "profileAppearance", "long"],
  ["herkunft", "profileBackground", "long"],
  ["stimme", "profileVoice", "long"],
  ["notizen", "profileNotes", "long"],
];
