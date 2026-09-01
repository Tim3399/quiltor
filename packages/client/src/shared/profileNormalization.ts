import type { NoteMark } from "./noteMark";
import type { NoteReference } from "./worldReference";

export const LEGACY_PROFILE_FIELD_KEYS = [
  "alter",
  "rolle",
  "aussehen",
  "herkunft",
  "stimme",
] as const;

export type LegacyProfileFieldKey = (typeof LEGACY_PROFILE_FIELD_KEYS)[number];

export const LEGACY_PROFILE_FIELD_LABELS: Record<LegacyProfileFieldKey, string> = {
  alter: "Alter",
  rolle: "Rolle in der Geschichte",
  aussehen: "Aussehen",
  herkunft: "Herkunft & Vorgeschichte",
  stimme: "Stimme & Sprechweise",
};

export type LegacyProfileFieldLabel = (key: LegacyProfileFieldKey) => string;

export interface NormalizableProfileField {
  id: string;
  key: string;
  value: string;
  [key: string]: unknown;
}

export interface NormalizableProfile {
  fields?: NormalizableProfileField[];
  alter?: string;
  rolle?: string;
  aussehen?: string;
  herkunft?: string;
  stimme?: string;
  notizen?: string;
  noteReferences?: NoteReference[];
  noteMarks?: NoteMark[];
  extra?: Array<{ k: string; v: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Converts the two pre-TECH-010 field shapes into stable canonical fields.
 *
 * A present `fields` array always wins, including an intentionally empty one. This prevents a
 * removed migrated field from reappearing from the compatibility columns on the next render.
 */
export function normalizeProfileFields(
  profile: NormalizableProfile,
  ownerId: string,
  labelForLegacy: LegacyProfileFieldLabel = (key) => LEGACY_PROFILE_FIELD_LABELS[key],
): NormalizableProfileField[] {
  if (profile.fields !== undefined) return profile.fields.map((field) => ({ ...field }));
  return [
    ...LEGACY_PROFILE_FIELD_KEYS.flatMap((legacyKey) => {
      const value = profile[legacyKey];
      return typeof value === "string" && value
        ? [
            {
              id: `profile-field:${ownerId}:legacy:${legacyKey}`,
              key: labelForLegacy(legacyKey),
              value,
            },
          ]
        : [];
    }),
    ...(profile.extra || []).map(({ k, v, ...extensions }, index) => ({
      ...extensions,
      id: `profile-field:${ownerId}:extra:${index}`,
      key: k,
      value: v,
    })),
  ];
}

/** Returns the canonical author-facing profile without writing compatibility-only field shapes. */
export function normalizeProfile<T extends NormalizableProfile>(
  profile: T,
  ownerId: string,
  labelForLegacy?: LegacyProfileFieldLabel,
): Omit<T, LegacyProfileFieldKey | "extra"> &
  NormalizableProfile & { fields: NormalizableProfileField[] } {
  const canonical = { ...profile };
  for (const legacyKey of LEGACY_PROFILE_FIELD_KEYS) delete canonical[legacyKey];
  delete canonical.extra;
  return {
    ...canonical,
    fields: normalizeProfileFields(profile, ownerId, labelForLegacy),
  };
}
