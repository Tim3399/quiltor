// Types for the TypeScript importers of the test world (tests/e2e/support/example-world.ts).
// The documents are the raw v1 wire payloads; decode them with the client's decode*V1 before
// treating them as models.

export type WorldLanguage = "de" | "en";
export type WorldPart = "base" | "edge";

export interface ExampleWorldPayloads {
  manuscript: unknown;
  figures: unknown;
  storyboards: unknown;
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
