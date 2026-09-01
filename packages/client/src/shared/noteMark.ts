export const NOTE_MARK_KINDS = ["bold", "italic", "heading"] as const;
export const NOTE_HEADING_LEVELS = [1, 2, 3] as const;

export type NoteMarkKind = (typeof NOTE_MARK_KINDS)[number];
export type NoteHeadingLevel = (typeof NOTE_HEADING_LEVELS)[number];

type NoteMarkExtensions = { [key: string]: unknown };

export type NoteMark =
  | (NoteMarkExtensions & {
      from: number;
      to: number;
      kind: "bold" | "italic";
    })
  | (NoteMarkExtensions & {
      from: number;
      to: number;
      kind: "heading";
      level: NoteHeadingLevel;
    });

export function cloneNoteMarks(marks: readonly NoteMark[] | undefined): NoteMark[] | undefined {
  return marks?.map((mark) => ({ ...mark }));
}
