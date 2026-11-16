export {
  type ElementNote,
  type ElementNoteTarget,
  isChapterInTrash,
  noteOwnerFamily,
  resolveElementNote,
  titleHeadingLines,
  withChapterNote,
  withFigureNote,
} from "./elementNotes";
export { NoteEditor } from "./NoteEditor";
export { NoteReferenceProvider, useNoteReferenceContext } from "./NoteReferenceContext";
export { noteFocusCopy } from "./noteFocusCopy";
export { noteMarkdown } from "./noteMarkdown";
