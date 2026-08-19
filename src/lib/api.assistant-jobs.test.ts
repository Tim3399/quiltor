import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setActiveWorld } from "./api";
import type { AssistantReply } from "../types";

const REPLY: AssistantReply = {
  ok: true,
  message: "Done",
  proposals: [],
  sources: [],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completedJob() {
  return {
    id: "job-1",
    status: "completed" as const,
    progressId: null,
    result: REPLY,
    error: "",
    errorType: "",
    httpStatus: null,
    interactionId: "interaction-1",
    cancelRequested: false,
    createdAt: "2026-08-18T19:00:00+00:00",
    startedAt: "2026-08-18T19:00:00+00:00",
    finishedAt: "2026-08-18T19:00:01+00:00",
  };
}

beforeEach(() => {
  setActiveWorld("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assistant job API", () => {
  it("sends the client idempotency key and returns a completed job", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ ok: true, created: true, coalesced: false, job: completedJob() }, 202),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.assistantChat(
      "Who is Tarek?",
      [],
      undefined,
      undefined,
      undefined,
      "request-12345678",
    );

    expect(result).toEqual(REPLY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/assistant/jobs");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "Idempotency-Key": "request-12345678",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      worldId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      question: "Who is Tarek?",
    });
  });

  it("retries an ambiguous network failure with the exact same idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(
        response({ ok: true, created: false, coalesced: false, job: completedJob() }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.assistantChat(
      "Who is Tarek?",
      [],
      undefined,
      undefined,
      undefined,
      "request-stable-key",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(init.headers).toMatchObject({ "Idempotency-Key": "request-stable-key" });
    }
  });
});
