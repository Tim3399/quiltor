import { quiltorClient } from "../../platform";
import type { AssistantEntry } from "./conversationTypes";

/**
 * The assistant conversation of a world, kept on this device (T-269 S269-6).
 *
 * The entries carry work text -- questions about the manuscript, answers quoting it -- so on a
 * shared server they belong to the signed-in account: the key names the account's subject,
 * an index per account lets signing out find every world's history, and another account in
 * the same browser computes different keys. Without a subject (local mode: one person, one
 * machine) the key stays the world-only one it has always been.
 *
 * A world-only key read while an account is signed in dates from before this binding. Whose
 * it was cannot be told any more, so it is removed rather than adopted: adopting it would hand
 * the previous user's text to whoever signs in first on that device.
 */

const LEGACY_PREFIX = "quiltor-assistant";
const PREFIX = "quiltor-assistant.v2";
const LIMIT = 40;

function storage() {
  return quiltorClient.platform.preferences;
}

const part = (value: string) => encodeURIComponent(value);

function legacyKey(worldId: string): string {
  return `${LEGACY_PREFIX}:${worldId}`;
}

export function assistantHistoryKey(sub: string | undefined, worldId: string): string {
  return sub ? `${PREFIX}:${part(sub)}:${part(worldId)}` : legacyKey(worldId);
}

function indexKey(sub: string): string {
  return `${PREFIX}:index:${part(sub)}`;
}

function readIndex(sub: string): string[] {
  try {
    const raw = storage().get(indexKey(sub));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function remove(key: string): void {
  try {
    storage().remove(key);
  } catch {
    // A blocked store holds nothing to remove.
  }
}

export function readAssistantHistory(sub: string | undefined, worldId: string): AssistantEntry[] {
  if (sub) remove(legacyKey(worldId));
  try {
    const stored = storage().get(assistantHistoryKey(sub, worldId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function writeAssistantHistory(
  sub: string | undefined,
  worldId: string,
  entries: AssistantEntry[],
): void {
  const key = assistantHistoryKey(sub, worldId);
  try {
    storage().set(key, JSON.stringify(entries.slice(-LIMIT)));
    if (sub) {
      const keys = readIndex(sub);
      if (!keys.includes(key)) storage().set(indexKey(sub), JSON.stringify([...keys, key]));
    }
  } catch {
    // Storage blocked or full: the conversation stays in memory for this session.
  }
}

/** Signing out forgets this account's assistant history on this device, in every world. */
export function removeAllAssistantHistory(sub: string | undefined): void {
  if (!sub) return;
  for (const key of readIndex(sub)) remove(key);
  remove(indexKey(sub));
}
