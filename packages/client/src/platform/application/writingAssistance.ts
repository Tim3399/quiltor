import type { WritingIssue } from "../../modules/manuscript";

export type WritingAssistanceLookupMode = "dictionary" | "synonyms" | "translation";

export type WritingAssistanceLookupResult = {
  lemma: string;
  partOfSpeech: string;
  meaning: string;
  values: string[];
  source: string;
};

export type GrammarStatus = {
  supported: boolean;
  unsupportedReason: string;
  available: boolean;
  installed: boolean;
  running: boolean;
  version: string;
  javaVersion: number | null;
  javaRequired: number;
  externalConfigured: boolean;
  externalEnabled: boolean;
  download: { url: string; checksum: string; license: string };
};

export type WritingAssistanceStatus = {
  ok: boolean;
  installed: boolean;
  stale: boolean;
  version: string | null;
  sources: Record<
    string,
    { version: string; url: string; checksum: string; license: string; attribution: string }
  >;
  grammar?: GrammarStatus;
};

export interface WritingAssistanceGateway {
  status(): Promise<WritingAssistanceStatus>;
  installData(): Promise<{ ok: boolean; version: string; entries: number }>;
  lookup(
    locale: "de-DE" | "en-GB",
    mode: WritingAssistanceLookupMode,
    query: string,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    query: string;
    locale: string;
    mode: string;
    version: string;
    results: WritingAssistanceLookupResult[];
  }>;
  installGrammar(): Promise<GrammarStatus & { ok: boolean }>;
  checkGrammar(
    text: string,
    customWords: string[],
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; locale: "de-DE"; issues: WritingIssue[] }>;
}
