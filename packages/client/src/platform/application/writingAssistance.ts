import type { WritingIssue } from "../../modules/manuscript";

type WritingAssistanceLookupMode = "dictionary" | "synonyms" | "translation";

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
  /** False when the server's operator installs LanguageTool; missing means true. */
  installable?: boolean;
  download: { url: string; checksum: string; license: string };
};

export type WritingDataRelease = {
  available: boolean;
  reason: "not_published" | null;
  version: string | null;
  bytes: number | null;
};

export type WritingAssistanceStatus = {
  ok: boolean;
  installed: boolean;
  /**
   * How much vocabulary the installed data holds: "core" is the built-in
   * starter set of a few words, "full" an import of the upstream sources.
   * null while nothing current is installed.
   */
  coverage?: "core" | "full" | null;
  stale: boolean;
  /** False when the server's operator installs the language data; missing means true. */
  installable?: boolean;
  version: string | null;
  /**
   * Whether this release can download a dictionary at all. available false
   * with reason "not_published": no data release exists yet, so there is no
   * install to offer. Missing on older servers, which means available.
   */
  data?: WritingDataRelease;
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
