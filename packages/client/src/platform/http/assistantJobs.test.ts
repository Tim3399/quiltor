import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatformGateway } from "../createPlatformGateway";
import type { ApplicationGateway } from "../application";
import { createHttpApplicationGateway } from ".";
import type { AssistantReply } from "../../modules/assistant";

const REPLY: AssistantReply = {
  ok: true,
  message: "Done",
  proposals: [],
  sources: [],
};
let application: ApplicationGateway;

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

function queuedJob() {
  return {
    ...completedJob(),
    status: "queued" as const,
    result: null,
    interactionId: null,
    startedAt: null,
    finishedAt: null,
  };
}

function cancelledJob() {
  return {
    ...queuedJob(),
    status: "cancelled" as const,
    cancelRequested: true,
    finishedAt: "2026-08-18T19:00:01+00:00",
  };
}

beforeEach(() => {
  application = createHttpApplicationGateway(createPlatformGateway());
  application.worlds.select("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

afterEach(() => {
  vi.useRealTimers();
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

    const result = await application.assistant.chat(
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

  it("sends extraction mode and its explicit chapter scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        ok: true,
        created: true,
        coalesced: false,
        job: completedJob(),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await application.assistant.chat(
      "Update world",
      [],
      undefined,
      ["c2"],
      { runBatches: true, progressId: "progress-1", mode: "world_extraction" },
      "request-extraction",
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      chapterIds: ["c2"],
      runBatches: true,
      progressId: "progress-1",
      mode: "world_extraction",
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

    await application.assistant.chat(
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

  it("reports the durable server job before resuming it through the polling endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ok: true, created: true, coalesced: false, job: queuedJob() }, 202),
      )
      .mockResolvedValueOnce(response({ ok: true, job: completedJob() }));
    vi.stubGlobal("fetch", fetchMock);
    const created = vi.fn();

    await expect(
      application.assistant.chat(
        "Continue",
        [],
        undefined,
        undefined,
        undefined,
        "request-resume-key",
        created,
      ),
    ).resolves.toEqual(REPLY);

    expect(created).toHaveBeenCalledWith(expect.objectContaining({ status: "queued" }));
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/assistant/job?id=job-1&world=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("keeps polling the confirmed job after a temporary server outage", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ok: true, created: true, coalesced: false, job: queuedJob() }, 202),
      )
      .mockResolvedValueOnce(response({ error: { code: "unavailable" } }, 503))
      .mockResolvedValueOnce(response({ ok: true, job: completedJob() }));
    vi.stubGlobal("fetch", fetchMock);
    const created = vi.fn();

    const result = application.assistant.chat(
      "Continue",
      [],
      undefined,
      undefined,
      undefined,
      "request-durable-key",
      created,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual(REPLY);
    expect(created).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/assistant/jobs")).toHaveLength(1);
    expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
      "/api/assistant/job?id=job-1&world=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "/api/assistant/job?id=job-1&world=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("sends cancellation to the selected world's server job", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, job: cancelledJob() }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(application.assistant.cancelJob("job-1")).resolves.toMatchObject({
      status: "cancelled",
      cancelRequested: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/assistant/job/cancel");
    expect(JSON.parse(String(init.body))).toEqual({
      id: "job-1",
      worldId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("maps a server-cancelled wait and a local abort to AbortError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true, job: cancelledJob() })));
    await expect(application.assistant.wait("job-1")).rejects.toMatchObject({
      name: "AbortError",
    });

    const controller = new AbortController();
    controller.abort();
    await expect(application.assistant.wait("job-2", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("scopes assistant progress to the selected world", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, progress: null }));
    vi.stubGlobal("fetch", fetchMock);

    await application.assistant.progress("progress/a");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/progress?id=progress%2Fa&world=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
