export {
  chapterBreadcrumb,
  flatManuscriptStructure,
  flattenChapterIds,
  manuscriptStructure,
  orderedChapters,
} from "./binder/manuscriptTree";
export type { BookLayoutPresetId, BookLayoutSettings } from "./bookLayout";
export {
  BOOK_LAYOUT_PRESETS,
  bookLayoutMatchesPreset,
  DEFAULT_BOOK_LAYOUT,
  resolveBookLayout,
} from "./bookLayout";
export { normalizeMarks } from "./marks";
export {
  addDeterministicMentions,
  reconcileMentions,
  replaceEntityMentions,
} from "./mentions";
export type {
  Chapter,
  ChapterFolder,
  ChapterStoryTime,
  EntityMention,
  GrammarMode,
  Manuscript,
  ManuscriptStructure,
  ManuscriptTreeItem,
  TextMark,
  TextMarkKind,
  WritingIssue,
  WritingLocale,
} from "./model";
export { textSearchRanges } from "./search";
export { wordCount } from "./wordCount";
export type { ManuscriptEditorSessionState } from "./workspaceTypes";

export const loadTextWorkspace = () =>
  import("./TextWorkspace").then(({ TextWorkspace }) => ({ default: TextWorkspace }));
