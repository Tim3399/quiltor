import type {
  GrammarStatus,
  WritingAssistanceLookupResult,
  WritingAssistanceStatus,
} from "../../application";
import type { WritingIssue } from "../../../modules/manuscript";

export interface WritingAssistanceStatusWireV1 {
  ok: boolean;
  installed: boolean;
  stale: boolean;
  version: string | null;
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

export function decodeWritingAssistanceStatusV1(
  wire: WritingAssistanceStatusWireV1,
): WritingAssistanceStatus {
  return { ...wire, sources: { ...wire.sources }, grammar: wire.grammar && { ...wire.grammar } };
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
