// Types for the TypeScript importers of the test world (tests/e2e/support/example-world.ts).
// The documents are the raw v1 wire payloads; decode them with the client's decode*V1 before
// treating them as models.

export type WorldLanguage = "de" | "en";
export type WorldPart = "base" | "edge";

/** A chapter as the world writes it into the manuscript payload. */
export interface ExampleWorldChapter {
  id: string;
  title: string;
  body: string;
  note: string;
}

/** One version of the check part's chronicle chapter, oldest first (parts/edge.mjs). */
export interface ExampleWorldHistoryVersion {
  /** The chronicle chapter's text at this version. */
  text: string;
  /** Whether `otherChapterId` carries `appended.text` at this version. */
  elsewhere: boolean;
  /** The note the version is kept with. */
  note: string;
}

/** The versions the check part describes for T-86; only there when "edge" is included. */
export interface ExampleWorldHistory {
  chapterId: string;
  otherChapterId: string;
  appended: { text: string };
  versions: ExampleWorldHistoryVersion[];
}

export interface ExampleWorldPayloads {
  manuscript: { chapters: ExampleWorldChapter[]; [key: string]: unknown };
  figures: unknown;
  storyboards: unknown;
  history?: ExampleWorldHistory;
}

export declare const LANGUAGES: readonly WorldLanguage[];
export declare const PARTS: readonly WorldPart[];
export declare const HARBOUR_MAP_FILE: string;
export declare const DICTIONARIES: Record<WorldLanguage, Record<string, string>>;
export declare function harbourMapId(): string;
export declare function exampleWorldTitle(lang: WorldLanguage): string;
export declare function buildExampleWorld(
  lang: WorldLanguage,
  options?: { include?: readonly WorldPart[] },
): ExampleWorldPayloads;
