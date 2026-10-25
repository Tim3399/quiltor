import type { WritingAssistanceGateway } from "../application";
import {
  decodeGrammarCheckV1,
  decodeWritingAssistanceLookupV1,
  decodeWritingAssistanceStatusV1,
  type GrammarCheckWireV1,
  type WritingAssistanceLookupWireV1,
  type WritingAssistanceStatusWireV1,
} from "../contracts/v1/writingAssistance";
import { postJson, requestJson } from "./request";

export function createWritingAssistanceHttpGateway(): WritingAssistanceGateway {
  return {
    status: async () =>
      decodeWritingAssistanceStatusV1(
        await requestJson<WritingAssistanceStatusWireV1>("/api/writing-assistance/status"),
      ),
    installData: () =>
      postJson<{ ok: boolean; version: string; entries: number }>(
        "/api/writing-assistance/install",
        {},
      ),
    lookup: async (locale, mode, query, signal) =>
      decodeWritingAssistanceLookupV1(
        await postJson<WritingAssistanceLookupWireV1>(
          "/api/writing-assistance/lookup",
          { language: locale, mode, query },
          signal,
        ),
      ),
    installGrammar: () =>
      postJson<Awaited<ReturnType<WritingAssistanceGateway["installGrammar"]>>>(
        "/api/writing-assistance/grammar/install",
        {},
      ),
    checkGrammar: async (text, customWords, signal) =>
      decodeGrammarCheckV1(
        await postJson<GrammarCheckWireV1>(
          "/api/writing-assistance/check",
          { language: "de-DE", text, customWords },
          signal,
        ),
      ),
  };
}
