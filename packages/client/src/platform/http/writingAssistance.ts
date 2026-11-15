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
        await requestJson<GrammarCheckWireV1>("/api/writing-assistance/check", {
          method: "POST",
          headers: { "Content-Type": "application/json", [GRAMMAR_TAB_HEADER]: grammarTabId },
          body: JSON.stringify({ language: "de-DE", text, customWords }),
          signal,
        }),
      ),
  };
}

/** The header that names this tab to the grammar check (F-268-28). */
export const GRAMMAR_TAB_HEADER = "X-Quiltor-Tab";

// The server lets only the newest check of a session and tab count. Each tab names itself
// once, in memory only: sessionStorage would be copied into a duplicated tab, which would then
// share the key again. The id is a key and nothing more; the server trusts nothing about it.
function newTabId(): string {
  const random = globalThis.crypto;
  if (typeof random?.randomUUID === "function") return random.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** This tab's id for the grammar check. */
export const grammarTabId = newTabId();
