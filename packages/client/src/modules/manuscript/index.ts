export { textSearchRanges } from "./search";
export { normalizeMarks } from "./marks";
export {
  chapterBreadcrumb,
  flatManuscriptStructure,
  flattenChapterIds,
  manuscriptStructure,
  orderedChapters,
} from "./binder/manuscriptTree";
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

export const loadTextWorkspace = () =>
  import("./TextWorkspace").then(({ TextWorkspace }) => ({ default: TextWorkspace }));
