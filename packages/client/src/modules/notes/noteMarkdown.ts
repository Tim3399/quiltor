import type { NoteMark } from "../../shared";
import { normalizeNoteMarks } from "./noteMarks";

function emphasize(text: string, bold: boolean, italic: boolean) {
  if ((!bold && !italic) || !text.trim()) return text;
  const leading = text.match(/^\s*/u)?.[0] ?? "";
  const trailing = text.match(/\s*$/u)?.[0] ?? "";
  const content = text.slice(leading.length, text.length - trailing.length);
  const marker = bold && italic ? "***" : bold ? "**" : "*";
  return `${leading}${marker}${content}${marker}${trailing}`;
}

function formattedLine(text: string, offset: number, marks: readonly NoteMark[]) {
  const inline = marks.filter(
    (mark) => mark.kind !== "heading" && mark.to > offset && mark.from < offset + text.length,
  );
  if (!inline.length) return text;
  const boundaries = new Set([0, text.length]);
  for (const mark of inline) {
    boundaries.add(Math.max(0, mark.from - offset));
    boundaries.add(Math.min(text.length, mark.to - offset));
  }
  const cuts = [...boundaries].sort((left, right) => left - right);
  const runs: Array<{ text: string; bold: boolean; italic: boolean }> = [];
  for (const [index, from] of cuts.slice(0, -1).entries()) {
    const to = cuts[index + 1];
    const bold = inline.some(
      (mark) => mark.kind === "bold" && mark.from <= offset + from && mark.to >= offset + to,
    );
    const italic = inline.some(
      (mark) => mark.kind === "italic" && mark.from <= offset + from && mark.to >= offset + to,
    );
    const previous = runs.at(-1);
    if (previous?.bold === bold && previous.italic === italic)
      previous.text += text.slice(from, to);
    else runs.push({ text: text.slice(from, to), bold, italic });
  }
  return runs.map((run) => emphasize(run.text, run.bold, run.italic)).join("");
}

/** Serialize note formatting without ever changing the stored/searchable plain text. */
export function noteMarkdown(text: string, marks: readonly NoteMark[] = [], headingOffset = 0) {
  const normalized = normalizeNoteMarks(text, marks);
  const output: string[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const heading = normalized.find((mark) => mark.kind === "heading" && mark.from === offset);
    const prefix =
      heading?.kind === "heading"
        ? `${"#".repeat(Math.min(6, heading.level + headingOffset))} `
        : "";
    output.push(`${prefix}${formattedLine(line, offset, normalized)}`);
    offset += line.length + 1;
  }
  return output.join("\n");
}
