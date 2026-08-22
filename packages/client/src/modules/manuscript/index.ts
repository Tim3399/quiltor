export { textSearchRanges } from "./search";
export { normalizeMarks } from "./marks";
export {
  addDeterministicMentions,
  reconcileMentions,
  replaceEntityMentions,
} from "./mentions";
export type {
  Chapter,
  EntityMention,
  GrammarMode,
  Manuscript,
  TextMark,
  TextMarkKind,
  WritingIssue,
  WritingLocale,
} from "./model";

export const loadTextWorkspace = () =>
  import("./TextWorkspace").then(({ TextWorkspace }) => ({ default: TextWorkspace }));
