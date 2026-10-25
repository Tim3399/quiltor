export {
  chapterBreadcrumb,
  chaptersInBook,
  isChapterInBook,
  manuscriptStructure,
  orderedChapters,
} from "./binder/manuscriptTree";
export type { BookLayoutSettings } from "./bookLayout";
export { DEFAULT_BOOK_LAYOUT } from "./bookLayout";
export { markedSegments, normalizeMarks } from "./marks";
export {
  addDeterministicMentions,
  reconcileMentions,
  replaceEntityMentions,
} from "./mentions";
export type {
  Chapter,
  EntityMention,
  Manuscript,
  TextMark,
  TextMarkKind,
  WritingIssue,
} from "./model";
export { textSearchRanges } from "./search";
export { wordCount } from "./wordCount";
export type { ManuscriptEditorSessionState } from "./workspaceTypes";

export const loadTextWorkspace = () =>
  import("./TextWorkspace").then(({ TextWorkspace }) => ({ default: TextWorkspace }));
