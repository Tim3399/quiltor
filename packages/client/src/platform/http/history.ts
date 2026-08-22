import type { HistoryGateway } from "../application";
import { requestJson, withWorldQuery, type HttpApplicationState } from "./request";

export function createHistoryHttpGateway(state: HttpApplicationState): HistoryGateway {
  return {
    log: () =>
      requestJson<{
        ok: boolean;
        commits: Array<{ hash: string; shortHash: string; date: string; subject: string }>;
      }>(withWorldQuery(state, "/api/history")),
    diff: (ref = "WORK", word = true, all = false) =>
      requestJson<{ ok: boolean; diff: string; newFiles: string[]; mode: "word" | "line" }>(
        withWorldQuery(
          state,
          `/api/history/diff?ref=${encodeURIComponent(ref)}&mode=${word ? "word" : "line"}&all=${all ? 1 : 0}`,
        ),
      ),
    textVersion: (ref: string, chapter: number, title: string) =>
      requestJson<{ ok: boolean; isNew: boolean; text: string }>(
        withWorldQuery(
          state,
          `/api/history/chapter-text?ref=${encodeURIComponent(ref)}&chapter=${chapter}&title=${encodeURIComponent(title)}`,
        ),
      ),
  };
}
