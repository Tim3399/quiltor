export type WritingLocale = "de-DE";

export interface EntityMention {
  id: string;
  elementId: string;
  from: number;
  to: number;
  surface: string;
  source: "completion" | "helper" | "deterministic" | "llm-assisted";
  confidence: number;
}

export type TextMarkKind = "bold" | "italic";

export interface TextMark {
  from: number;
  to: number;
  kind: TextMarkKind;
}

export interface ChapterStoryTime {
  startMomentId: string;
  endMomentId?: string;
  [key: string]: unknown;
}

export interface Chapter {
  id: string;
  title: string;
  body: string;
  note: string;
  storyTime?: ChapterStoryTime;
  mentions?: EntityMention[];
  marks?: TextMark[];
  [key: string]: unknown;
}

export interface ChapterFolder {
  id: string;
  title: string;
  [key: string]: unknown;
}

export type ManuscriptTreeItem =
  | {
      id: string;
      kind: "chapter";
      chapterId: string;
      parentFolderId?: string;
      position: number;
      [key: string]: unknown;
    }
  | {
      id: string;
      kind: "folder";
      folderId: string;
      parentFolderId?: string;
      position: number;
      [key: string]: unknown;
    };

export interface ManuscriptStructure {
  folders: ChapterFolder[];
  items: ManuscriptTreeItem[];
}

export type GrammarMode = "manual" | "automatic";

export type WritingIssue = {
  id: string;
  from: number;
  to: number;
  ruleId: string;
  category: string;
  message: string;
  replacements: string[];
};

export interface Manuscript {
  chapters: Chapter[];
  structure?: ManuscriptStructure;
  language?: WritingLocale;
  grammarMode?: GrammarMode;
  words?: Array<string | { w: string; d?: string }>;
  zeichenAktiv?: string[];
  [key: string]: unknown;
}
