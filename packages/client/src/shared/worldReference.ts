export type WorldReferenceTarget =
  | { kind: "entity"; id: string }
  | { kind: "place"; id: string }
  | { kind: "timeline"; id: string }
  | { kind: "chapter"; id: string }
  | { kind: "storyboard"; id: string };

/** A stable-ID link over an exact UTF-16 range in an author-owned note string. */
export interface NoteReference {
  id: string;
  target: WorldReferenceTarget;
  from: number;
  to: number;
  surface: string;
  [key: string]: unknown;
}

/** Wire-v1 keeps reference surfaces compact even when an imported target has an extreme label. */
export const NOTE_REFERENCE_SURFACE_MAX_LENGTH = 1000;

/**
 * Shortens a visible reference label without splitting a UTF-16 surrogate pair.
 * The ellipsis makes the lossy display explicit while the stable target ID stays untouched.
 */
export function normalizeNoteReferenceSurface(value: string) {
  if (value.length <= NOTE_REFERENCE_SURFACE_MAX_LENGTH) return value;
  let end = NOTE_REFERENCE_SURFACE_MAX_LENGTH - 1;
  const before = value.charCodeAt(end - 1);
  const after = value.charCodeAt(end);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1;
  return `${value.slice(0, end)}…`;
}

export function worldReferenceKey(target: WorldReferenceTarget) {
  return `${target.kind}:${target.id}`;
}
