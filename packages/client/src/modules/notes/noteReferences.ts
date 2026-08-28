import { normalizeNoteReferenceSurface } from "../../shared";
import type { NoteReference, WorldReferenceCandidate } from "../world-references";

export interface ActiveNoteReferenceQuery {
  /** Inclusive offset of the leading `@`, measured in UTF-16 code units. */
  from: number;
  /** Exclusive caret offset, measured in UTF-16 code units. */
  to: number;
  query: string;
}

export interface NoteReferenceInsertion {
  text: string;
  references: NoteReference[];
  caret: number;
}

interface TextReplacement {
  from: number;
  to: number;
  insert: string;
}

const queryCharacters = /^[\p{L}\p{M}\p{N}_'’.-]*$/u;
const wordCharacter = /[\p{L}\p{M}\p{N}_]/u;
const targetKinds = new Set(["entity", "place", "timeline", "chapter", "storyboard"]);

function isHighSurrogate(value: number) {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number) {
  return value >= 0xdc00 && value <= 0xdfff;
}

function isUtf16Boundary(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return true;
  return !(isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset)));
}

function codePointBefore(text: string, offset: number) {
  if (offset <= 0) return "";
  const previous = text.charCodeAt(offset - 1);
  if (isLowSurrogate(previous) && offset >= 2) return text.slice(offset - 2, offset);
  return text.slice(offset - 1, offset);
}

function isValidTarget(reference: NoteReference) {
  const target = reference.target as { kind?: unknown; id?: unknown };
  return (
    typeof target === "object" &&
    target !== null &&
    typeof target.kind === "string" &&
    targetKinds.has(target.kind) &&
    typeof target.id === "string" &&
    target.id.trim().length > 0
  );
}

function compareReferences(left: NoteReference, right: NoteReference) {
  return left.from - right.from || left.to - right.to || left.id.localeCompare(right.id);
}

/**
 * Finds the unfinished `@query` immediately before a textarea caret.
 *
 * Queries deliberately stop at whitespace and punctuation other than characters commonly used
 * in names. Multi-word candidates remain discoverable from any one of their words.
 */
export function findActiveNoteReferenceQuery(
  text: string,
  caret: number,
): ActiveNoteReferenceQuery | null {
  if (
    !Number.isInteger(caret) ||
    caret <= 0 ||
    caret > text.length ||
    !isUtf16Boundary(text, caret)
  ) {
    return null;
  }

  const at = text.lastIndexOf("@", caret - 1);
  if (at < 0 || !isUtf16Boundary(text, at)) return null;

  const query = text.slice(at + 1, caret);
  if (!queryCharacters.test(query)) return null;

  const preceding = codePointBefore(text, at);
  if (preceding && (wordCharacter.test(preceding) || preceding === "@")) return null;

  return { from: at, to: caret, query };
}

/** Removes structurally invalid, overlapping, duplicate, or surface-mismatched references. */
export function reconcileNoteReferences(
  text: string,
  references: readonly NoteReference[],
): NoteReference[] {
  const reconciled: NoteReference[] = [];
  const identifiers = new Set<string>();
  let previousEnd = -1;

  for (const reference of [...references].sort(compareReferences)) {
    const valid =
      typeof reference.id === "string" &&
      reference.id.trim().length > 0 &&
      !identifiers.has(reference.id) &&
      isValidTarget(reference) &&
      Number.isInteger(reference.from) &&
      Number.isInteger(reference.to) &&
      reference.from >= 0 &&
      reference.from < reference.to &&
      reference.to <= text.length &&
      isUtf16Boundary(text, reference.from) &&
      isUtf16Boundary(text, reference.to) &&
      typeof reference.surface === "string" &&
      reference.surface.length > 0 &&
      reference.from >= previousEnd &&
      text.slice(reference.from, reference.to) === reference.surface;

    if (!valid) continue;
    reconciled.push(reference);
    identifiers.add(reference.id);
    previousEnd = reference.to;
  }

  return reconciled;
}

function mapThroughReplacement(
  references: readonly NoteReference[],
  replacement: TextReplacement,
  afterText: string,
) {
  const removedLength = replacement.to - replacement.from;
  const delta = replacement.insert.length - removedLength;

  const mapped = references.flatMap((reference): NoteReference[] => {
    if (removedLength === 0) {
      if (replacement.from > reference.from && replacement.from < reference.to) return [];
      if (replacement.from <= reference.from) {
        return [
          {
            ...reference,
            from: reference.from + delta,
            to: reference.to + delta,
          },
        ];
      }
      return [reference];
    }

    if (replacement.to <= reference.from) {
      return [
        {
          ...reference,
          from: reference.from + delta,
          to: reference.to + delta,
        },
      ];
    }
    if (replacement.from >= reference.to) return [reference];
    return [];
  });

  return reconcileNoteReferences(afterText, mapped);
}

function replacementBetween(beforeText: string, afterText: string): TextReplacement | null {
  if (beforeText === afterText) return null;

  const sharedLength = Math.min(beforeText.length, afterText.length);
  let from = 0;
  while (from < sharedLength && beforeText.charCodeAt(from) === afterText.charCodeAt(from)) {
    from += 1;
  }

  // A code-unit diff may stop between the halves of an astral character. Expand the replacement
  // to code-point boundaries while retaining UTF-16 offsets, matching textarea selectionStart.
  while (from > 0 && (!isUtf16Boundary(beforeText, from) || !isUtf16Boundary(afterText, from))) {
    from -= 1;
  }

  let suffixLength = 0;
  const maximumSuffix = sharedLength - from;
  while (
    suffixLength < maximumSuffix &&
    beforeText.charCodeAt(beforeText.length - suffixLength - 1) ===
      afterText.charCodeAt(afterText.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }

  let beforeTo = beforeText.length - suffixLength;
  let afterTo = afterText.length - suffixLength;
  while (
    suffixLength > 0 &&
    (!isUtf16Boundary(beforeText, beforeTo) || !isUtf16Boundary(afterText, afterTo))
  ) {
    suffixLength -= 1;
    beforeTo = beforeText.length - suffixLength;
    afterTo = afterText.length - suffixLength;
  }

  return {
    from,
    to: beforeTo,
    insert: afterText.slice(from, afterTo),
  };
}

/**
 * Maps ID-backed ranges through one textarea value change.
 *
 * A textarea does not expose its native edit transaction, so the change is conservatively reduced
 * to one replacement using the longest common prefix/suffix. Disjoint edits in one update may
 * therefore invalidate an unchanged reference between them rather than retaining a wrong link.
 */
export function mapNoteReferences(
  references: readonly NoteReference[],
  beforeText: string,
  afterText: string,
): NoteReference[] {
  const validBefore = reconcileNoteReferences(beforeText, references);
  const replacement = replacementBetween(beforeText, afterText);
  if (!replacement) return reconcileNoteReferences(afterText, validBefore);
  return mapThroughReplacement(validBefore, replacement, afterText);
}

/** Replaces an active `@query` with the selected label and creates its stable reference range. */
export function insertNoteReference(
  text: string,
  references: readonly NoteReference[],
  query: ActiveNoteReferenceQuery,
  candidate: WorldReferenceCandidate,
  idFactory: () => string = () => crypto.randomUUID(),
): NoteReferenceInsertion {
  const active = findActiveNoteReferenceQuery(text, query.to);
  if (
    !active ||
    active.from !== query.from ||
    active.to !== query.to ||
    active.query !== query.query
  ) {
    throw new RangeError("The note reference query is no longer active.");
  }
  if (!candidate.label.trim()) throw new RangeError("A note reference label cannot be empty.");
  const surface = normalizeNoteReferenceSurface(candidate.label);

  const candidateReference: NoteReference = {
    id: "candidate",
    target: candidate.target,
    from: 0,
    to: 1,
    surface: "x",
  };
  if (!isValidTarget(candidateReference)) {
    throw new RangeError("A note reference target requires a supported kind and stable ID.");
  }

  const nextText = text.slice(0, query.from) + surface + text.slice(query.to);
  const mapped = mapThroughReplacement(
    reconcileNoteReferences(text, references),
    { from: query.from, to: query.to, insert: surface },
    nextText,
  );
  const id = idFactory();
  if (!id.trim() || mapped.some((reference) => reference.id === id)) {
    throw new Error("The note reference ID must be non-empty and unique.");
  }

  const reference: NoteReference = {
    id,
    target: { ...candidate.target },
    from: query.from,
    to: query.from + surface.length,
    surface,
  };

  return {
    text: nextText,
    references: reconcileNoteReferences(nextText, [...mapped, reference]),
    caret: reference.to,
  };
}
