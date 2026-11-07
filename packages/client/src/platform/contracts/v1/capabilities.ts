// GET /api/capabilities, contract application.capabilities v1 (T-102).
// The decoder never throws: a flag it does not know, or one that is not a real
// boolean, is left out, and the caller falls back for whatever is missing.

const INSTANCE_CAPABILITY_KEYS = [
  "multiUser",
  "signOut",
  "deviceSync",
  "assistantInstall",
  "writingDataInstall",
  "grammarInstall",
] as const;

type InstanceCapabilityKey = (typeof INSTANCE_CAPABILITY_KEYS)[number];

export type InstanceCapabilitiesV1 = Partial<Record<InstanceCapabilityKey, boolean>>;

/** Flags of the asking session; they can change while it lasts (T-102 D). */
type UserCapabilitiesV1 = { serverAi?: boolean };

export type CapabilitiesV1 = {
  instance: InstanceCapabilitiesV1;
  user: UserCapabilitiesV1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The answer, or null when it is not a v1 capabilities answer at all. */
export function decodeCapabilitiesV1(value: unknown): CapabilitiesV1 | null {
  if (!isRecord(value) || value.ok !== true || value.version !== 1) return null;
  const instance: InstanceCapabilitiesV1 = {};
  const wire = isRecord(value.instance) ? value.instance : {};
  for (const key of INSTANCE_CAPABILITY_KEYS) {
    const flag = wire[key];
    if (typeof flag === "boolean") instance[key] = flag;
  }
  const user: UserCapabilitiesV1 = {};
  const userWire = isRecord(value.user) ? value.user : {};
  if (typeof userWire.serverAi === "boolean") user.serverAi = userWire.serverAi;
  return { instance, user };
}
