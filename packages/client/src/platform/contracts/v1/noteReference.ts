import type { NoteReference, WorldReferenceTarget } from "../../../shared";
import {
  WireContractError,
  wireArray,
  wireEnum,
  wireInteger,
  wireRecord,
  wireString,
} from "./validation";

const REFERENCE_KINDS = ["entity", "place", "timeline", "chapter", "storyboard"] as const;

export type NoteReferenceWireV1 = NoteReference;

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

/** Validate stable reference IDs and exact, non-overlapping UTF-16 note ranges. */
export function validateNoteReferences(
  value: unknown,
  note: string,
  path: string,
): NoteReferenceWireV1[] {
  const values = wireArray(value, path);
  if (values.length > 10_000) throw new WireContractError(path);
  const ids = new Set<string>();
  const references = values.map((referenceValue, index) => {
    const referencePath = `${path}[${index}]`;
    const reference = wireRecord(referenceValue, referencePath);
    const id = wireString(reference.id, `${referencePath}.id`, { min: 1, max: 500 });
    if (ids.has(id)) throw new WireContractError(`${referencePath}.id`);
    ids.add(id);
    const target = wireRecord(reference.target, `${referencePath}.target`);
    const kind = wireEnum(target.kind, REFERENCE_KINDS, `${referencePath}.target.kind`);
    // Target IDs must accept every valid source-document ID. Story-world IDs are intentionally
    // unbounded in v1, unlike the reference record's own generated ID.
    const targetId = wireString(target.id, `${referencePath}.target.id`, { min: 1 });
    const from = wireInteger(reference.from, `${referencePath}.from`, { min: 0 });
    const to = wireInteger(reference.to, `${referencePath}.to`, { min: 1 });
    const surface = wireString(reference.surface, `${referencePath}.surface`, {
      min: 1,
      max: 1000,
    });
    if (
      to <= from ||
      to > note.length ||
      !isUtf16Boundary(note, from) ||
      !isUtf16Boundary(note, to) ||
      note.slice(from, to) !== surface
    ) {
      throw new WireContractError(referencePath);
    }
    return {
      ...reference,
      target: { ...target, kind, id: targetId } as WorldReferenceTarget,
      id,
      from,
      to,
      surface,
    } as NoteReferenceWireV1;
  });
  let previousEnd = -1;
  for (const reference of [...references].sort((left, right) => left.from - right.from)) {
    if (reference.from < previousEnd) throw new WireContractError(path);
    previousEnd = reference.to;
  }
  return references;
}

export function cloneNoteReferences(
  references: readonly NoteReferenceWireV1[] | undefined,
): NoteReferenceWireV1[] | undefined {
  return references?.map((reference) => ({
    ...reference,
    target: { ...reference.target },
  }));
}
