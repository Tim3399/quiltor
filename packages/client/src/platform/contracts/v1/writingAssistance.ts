import type {
  GrammarStatus,
  WritingAssistanceLookupResult,
  WritingAssistanceStatus,
  WritingDataRelease,
  WritingInstalledSource,
} from "../../application";
import type { WritingIssue } from "../../../modules/manuscript";

export interface WritingAssistanceStatusWireV1 {
  ok: boolean;
  installed: boolean;
  coverage?: "core" | "full" | null;
  stale: boolean;
  version: string | null;
  data?: WritingDataRelease;
  installed_sources?: unknown;
  sources: Record<
    string,
    { version: string; url: string; checksum: string; license: string; attribution: string }
  >;
  grammar?: GrammarStatus;
}

export interface WritingAssistanceLookupWireV1 {
  ok: boolean;
  query: string;
  language: string;
  mode: string;
  version: string;
  results: WritingAssistanceLookupResult[];
}

export interface GrammarCheckWireV1 {
  ok: boolean;
  language: "de-DE";
  issues: WritingIssue[];
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Entries without a name are dropped; any other missing field becomes "". */
function decodeInstalledSources(wire: unknown): WritingInstalledSource[] {
  if (!Array.isArray(wire)) return [];
  return wire.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const source = entry as Record<string, unknown>;
    const name = text(source.name).trim();
    if (!name) return [];
    return [
      {
        name,
        url: text(source.url),
        license: text(source.license),
        licenseUrl: text(source.license_url),
      },
    ];
  });
}

export function decodeWritingAssistanceStatusV1(
  wire: WritingAssistanceStatusWireV1,
): WritingAssistanceStatus {
  const { installed_sources: installedSources, ...rest } = wire;
  return {
    ...rest,
    installedSources: decodeInstalledSources(installedSources),
    data: wire.data && { ...wire.data },
    sources: { ...wire.sources },
    grammar: wire.grammar && { ...wire.grammar },
  };
}

export function decodeWritingAssistanceLookupV1(wire: WritingAssistanceLookupWireV1) {
  const { language, ...rest } = wire;
  return {
    ...rest,
    locale: language,
    results: wire.results.map((result) => ({ ...result, values: [...result.values] })),
  };
}

export function decodeGrammarCheckV1(wire: GrammarCheckWireV1) {
  const { language, ...rest } = wire;
  return { ...rest, locale: language, issues: wire.issues.map((issue) => ({ ...issue })) };
}
