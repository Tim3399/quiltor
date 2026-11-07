import type { NoteMark, NoteReference, WorldReferenceTarget } from "../../shared";

/**
 * The one note of a chapter, figure, place or timeline moment (T-177).
 *
 * A Storyboard reference card shows and edits this note instead of a text of its own, so every
 * view of an element reads and writes the same value. The documents are typed by shape only:
 * this module sits below manuscript and story world and must not import them.
 */
export type ElementNote = {
  text: string;
  noteReferences: NoteReference[];
  noteMarks: NoteMark[];
};

export type ElementNoteTarget = Exclude<WorldReferenceTarget, { kind: "storyboard" }>;

type NoteRanges = { noteReferences?: NoteReference[]; noteMarks?: NoteMark[] };
type ChapterLike = NoteRanges & { id: string; note: string };
type ProfileLike = NoteRanges & { notes?: string };
type FigureLike = { id: string; profile?: ProfileLike };
type MomentLike = NoteRanges & { id: string; note?: string };

export type ManuscriptNotes = { chapters: ChapterLike[] };
export type FigureNotes = { nodes: FigureLike[]; timeline?: MomentLike[] };

function noteOf(text: string | undefined, ranges: NoteRanges): ElementNote {
  return {
    text: text ?? "",
    noteReferences: ranges.noteReferences ?? [],
    noteMarks: ranges.noteMarks ?? [],
  };
}

/** The note `target` points at, or null when the element no longer exists. */
export function resolveElementNote(
  target: ElementNoteTarget,
  manuscript: ManuscriptNotes,
  figures: FigureNotes,
): ElementNote | null {
  if (target.kind === "chapter") {
    const chapter = manuscript.chapters.find((item) => item.id === target.id);
    return chapter ? noteOf(chapter.note, chapter) : null;
  }
  if (target.kind === "timeline") {
    const moment = figures.timeline?.find((item) => item.id === target.id);
    return moment ? noteOf(moment.note, moment) : null;
  }
  // Places are figures of kind "ort": both kinds share the figure's profile note.
  const figure = figures.nodes.find((item) => item.id === target.id);
  return figure ? noteOf(figure.profile?.notes, figure.profile ?? {}) : null;
}

/** `manuscript` with the chapter's note replaced, or null when the chapter is gone. */
export function withChapterNote<M extends ManuscriptNotes>(
  manuscript: M,
  chapterId: string,
  note: ElementNote,
): M | null {
  if (!manuscript.chapters.some((chapter) => chapter.id === chapterId)) return null;
  return {
    ...manuscript,
    chapters: manuscript.chapters.map((chapter) =>
      chapter.id === chapterId
        ? {
            ...chapter,
            note: note.text,
            noteReferences: note.noteReferences,
            noteMarks: note.noteMarks,
          }
        : chapter,
    ),
  } as M;
}

/** `figures` with the figure's, place's or moment's note replaced, or null when it is gone. */
export function withFigureNote<F extends FigureNotes>(
  figures: F,
  target: Exclude<ElementNoteTarget, { kind: "chapter" }>,
  note: ElementNote,
): F | null {
  if (target.kind === "timeline") {
    const timeline = figures.timeline ?? [];
    if (!timeline.some((moment) => moment.id === target.id)) return null;
    return {
      ...figures,
      timeline: timeline.map((moment) =>
        moment.id === target.id
          ? {
              ...moment,
              note: note.text,
              noteReferences: note.noteReferences,
              noteMarks: note.noteMarks,
            }
          : moment,
      ),
    } as F;
  }
  if (!figures.nodes.some((node) => node.id === target.id)) return null;
  return {
    ...figures,
    nodes: figures.nodes.map((node) =>
      node.id === target.id
        ? {
            ...node,
            profile: {
              ...node.profile,
              notes: note.text,
              noteReferences: note.noteReferences,
              noteMarks: note.noteMarks,
            },
          }
        : node,
    ),
  } as F;
}

export type NoteFamily = "manuscript" | "figures" | "storyboards";

/**
 * The document family whose history holds the note a focused editor shows, read from the
 * `data-note-owner` key (`kind:id`) the note editor writes. A chapter's note lives in the
 * manuscript, a figure's, place's and moment's in the story world, a free Storyboard card's in
 * the Storyboard; an unknown key belongs to no family.
 */
export function noteOwnerFamily(ownerKey: string): NoteFamily | null {
  const kind = ownerKey.slice(0, ownerKey.indexOf(":"));
  if (kind === "chapter") return "manuscript";
  if (kind === "entity" || kind === "place" || kind === "timeline") return "figures";
  if (kind === "storyboard") return "storyboards";
  return null;
}
