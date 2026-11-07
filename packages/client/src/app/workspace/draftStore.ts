import { quiltorClient } from "../../platform";

export type DocumentFamily = "manuscript" | "figures" | "storyboards";

/**
 * Unsaved work kept on this device when a save is refused because the session ended
 * (T-58 P7b, D-102). Keycloak may end a session while the author is typing; every save then
 * answers 401, and a reload or a closed tab would lose what was typed since the last save.
 *
 * One draft per signed-in user, world and document family. A family is the unit the autosave
 * writes, so it is the unit a draft can be restored as: a chapter cut out of the manuscript
 * could not be put back without merging it into whatever the server holds by then. The offer
 * names the chapters and elements the draft changes (see `draftChanges`), which is what the
 * author needs to decide.
 *
 * Stored through the platform's preference store, which a browser keeps across a reload, a
 * closed tab and a restart -- a per-tab session store would not. Every access
 * is guarded: with storage blocked or full, saving behaves exactly as it did before.
 */

const PREFIX = "quiltor.draft.v1";

export interface DraftOwner {
  /** The OIDC subject. Without one (local mode) nothing is ever stored. */
  sub: string;
  worldId: string;
}

export interface StoredDraft<T = unknown> {
  family: DocumentFamily;
  savedAt: number;
  /** The revision the draft was edited on; adopting it saves against exactly this one. */
  baseRevision?: number;
  value: T;
}

function storage() {
  return quiltorClient.platform.preferences;
}

function part(value: string): string {
  return encodeURIComponent(value);
}

export function draftKey(owner: DraftOwner, family: DocumentFamily): string {
  return `${PREFIX}:${part(owner.sub)}:${part(owner.worldId)}:${family}`;
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

function writeIndex(sub: string, keys: readonly string[]): void {
  try {
    if (keys.length === 0) storage().remove(indexKey(sub));
    else storage().set(indexKey(sub), JSON.stringify([...new Set(keys)]));
  } catch {
    // The index only serves sign-out; a blocked store has nothing to clean up either.
  }
}

/** Keeps `value` as the draft of this family. False when the store refused it. */
export function writeDraft<T>(
  owner: DraftOwner | null,
  family: DocumentFamily,
  value: T,
  baseRevision: number | undefined,
): boolean {
  if (!owner?.sub || !owner.worldId) return false;
  const key = draftKey(owner, family);
  const draft: StoredDraft<T> = { family, savedAt: Date.now(), baseRevision, value };
  try {
    storage().set(key, JSON.stringify(draft));
  } catch {
    return false;
  }
  writeIndex(owner.sub, [...readIndex(owner.sub), key]);
  return true;
}

export function readDraft<T>(
  owner: DraftOwner | null,
  family: DocumentFamily,
): StoredDraft<T> | null {
  if (!owner?.sub || !owner.worldId) return null;
  try {
    const raw = storage().get(draftKey(owner, family));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft<T>> | null;
    if (
      !parsed ||
      parsed.family !== family ||
      typeof parsed.savedAt !== "number" ||
      parsed.value === undefined ||
      (parsed.baseRevision !== undefined && !Number.isSafeInteger(parsed.baseRevision))
    ) {
      return null;
    }
    return parsed as StoredDraft<T>;
  } catch {
    return null;
  }
}

export function removeDraft(owner: DraftOwner | null, family: DocumentFamily): void {
  if (!owner?.sub || !owner.worldId) return;
  const key = draftKey(owner, family);
  try {
    storage().remove(key);
  } catch {
    // Nothing to do: the draft is either gone or unreachable.
  }
  writeIndex(
    owner.sub,
    readIndex(owner.sub).filter((stored) => stored !== key),
  );
}

/** Signing out forgets every draft of this user on this device, in every world. */
export function removeAllDrafts(sub: string | undefined): void {
  if (!sub) return;
  for (const key of readIndex(sub)) {
    try {
      storage().remove(key);
    } catch {
      // See removeDraft.
    }
  }
  writeIndex(sub, []);
}

type Named = { id?: unknown; [key: string]: unknown };

const COLLECTIONS: Record<DocumentFamily, readonly { key: string; label: string }[]> = {
  manuscript: [{ key: "chapters", label: "title" }],
  figures: [{ key: "nodes", label: "name" }],
  storyboards: [
    { key: "boards", label: "title" },
    { key: "nodes", label: "label" },
  ],
};

function entries(document: unknown, key: string): Map<string, Named> {
  const list = (document as Record<string, unknown> | null)?.[key];
  const result = new Map<string, Named>();
  if (!Array.isArray(list)) return result;
  for (const item of list) {
    if (item && typeof item === "object" && typeof (item as Named).id === "string") {
      result.set((item as Named).id as string, item as Named);
    }
  }
  return result;
}

/**
 * What a draft changes against the version loaded now: the names of the chapters (manuscript),
 * elements (figures) or boards and cards (storyboards) that differ, were added or were
 * removed. This is what the offer shows, so the author knows what adopting it touches.
 */
export function draftChanges(
  family: DocumentFamily,
  draft: unknown,
  loaded: unknown,
  untitled: string,
): string[] {
  const names: string[] = [];
  for (const { key, label } of COLLECTIONS[family]) {
    const mine = entries(draft, key);
    const theirs = entries(loaded, key);
    for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
      const a = mine.get(id);
      const b = theirs.get(id);
      if (a && b && JSON.stringify(a) === JSON.stringify(b)) continue;
      const name = String((a ?? b)?.[label] ?? "").trim();
      names.push(name || untitled);
    }
  }
  return names;
}
