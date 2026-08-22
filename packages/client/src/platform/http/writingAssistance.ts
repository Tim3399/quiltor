import type { WritingAssistanceGateway } from "../application";
import {
  decodeGrammarCheckV1,
  decodeWritingAssistanceLookupV1,
  decodeWritingAssistanceStatusV1,
  type GrammarCheckWireV1,
  type WritingAssistanceLookupWireV1,
  type WritingAssistanceStatusWireV1,
} from "../contracts/v1/writingAssistance";
import { requestJson } from "./request";

export function createWritingAssistanceHttpGateway(): WritingAssistanceGateway {
  return {
    status: async () =>
      decodeWritingAssistanceStatusV1(
        await requestJson<WritingAssistanceStatusWireV1>("/api/writing-assistance/status"),
      ),
    installData: () =>
      requestJson<{ ok: boolean; version: string; entries: number }>(
        "/api/writing-assistance/install",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      ),
    lookup: async (locale, mode, query, signal) =>
      decodeWritingAssistanceLookupV1(
        await requestJson<WritingAssistanceLookupWireV1>("/api/writing-assistance/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: locale, mode, query }),
          signal,
        }),
      ),
    installGrammar: () =>
      requestJson<Awaited<ReturnType<WritingAssistanceGateway["installGrammar"]>>>(
        "/api/writing-assistance/grammar/install",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      ),
    checkGrammar: async (text, customWords, signal) =>
      decodeGrammarCheckV1(
        await requestJson<GrammarCheckWireV1>("/api/writing-assistance/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: "de-DE", text, customWords }),
          signal,
        }),
      ),
  };
}
