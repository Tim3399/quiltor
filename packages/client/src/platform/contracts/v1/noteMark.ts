import type { NoteMark } from "../../../shared";
import { cloneNoteMarks } from "../../../shared";
import { WireContractError, wireArray, wireEnum, wireInteger, wireRecord } from "./validation";

export type NoteMarkWireV1 = NoteMark & { [key: string]: unknown };

function isUtf16Boundary(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

export function validateNoteMarks(value: unknown, text: string, path: string): NoteMarkWireV1[] {
  const values = wireArray(value, path);
  if (values.length > 10_000) throw new WireContractError(path);
  const decoded = values
    .map((markValue, index) => {
      const markPath = `${path}[${index}]`;
      const mark = wireRecord(markValue, markPath);
      const from = wireInteger(mark.from, `${markPath}.from`, { min: 0 });
      const to = wireInteger(mark.to, `${markPath}.to`, { min: 1 });
      const kind = wireEnum(mark.kind, ["bold", "italic", "heading"] as const, `${markPath}.kind`);
      if (
        to <= from ||
        to > text.length ||
        !isUtf16Boundary(text, from) ||
        !isUtf16Boundary(text, to)
      ) {
        throw new WireContractError(markPath);
      }
      if (kind === "heading") {
        const level = wireInteger(mark.level, `${markPath}.level`, { min: 1, max: 3 });
        if (
          (from > 0 && text[from - 1] !== "\n") ||
          (to < text.length && text[to] !== "\n") ||
          text.slice(from, to).includes("\n")
        ) {
          throw new WireContractError(markPath);
        }
        return { ...mark, from, to, kind, level } as NoteMarkWireV1;
      }
      if (mark.level !== undefined) throw new WireContractError(`${markPath}.level`);
      return { ...mark, from, to, kind } as NoteMarkWireV1;
    })
    .sort(
      (left, right) =>
        left.from - right.from || left.to - right.to || left.kind.localeCompare(right.kind),
    );
  const previousInlineEnd = new Map<string, number>();
  const headingLines = new Set<number>();
  for (const mark of decoded) {
    if (mark.kind === "heading") {
      if (headingLines.has(mark.from)) throw new WireContractError(path);
      headingLines.add(mark.from);
      continue;
    }
    if (mark.from < (previousInlineEnd.get(mark.kind) ?? -1)) throw new WireContractError(path);
    previousInlineEnd.set(mark.kind, mark.to);
  }
  return decoded;
}

export { cloneNoteMarks };
