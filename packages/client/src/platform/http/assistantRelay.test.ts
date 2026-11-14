import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationGateway } from "../application";
import { createPlatformGateway } from "../createPlatformGateway";
import { createHttpApplicationGateway } from ".";

const WORLD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
let application: ApplicationGateway;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REQUEST = {
  ticket: "t1",
  seq: 3,
  // The shape the server sends (EngineChoice.public()); a string here hid that 3.26 dropped
  // every ticket until the T-61 part 8a e2e ran a real one.
  engine: { kind: "cloud", grammar: false, provider: "openai" },
  payload: { messages: [] },
  limits: { maxOutputBytes: 262_144, answerBySeconds: 45 },
};

beforeEach(() => {
  application = createHttpApplicationGateway(createPlatformGateway());
  application.worlds.select(WORLD);
});

afterEach(() => vi.unstubAllGlobals());

describe("assistant relay API", () => {
  it("polls next for the job in the selected world and decodes the ticket", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, request: REQUEST }));
    vi.stubGlobal("fetch", fetchMock);
    const next = await application.assistant.relayNext("job 1");
    expect(next).toEqual({ kind: "request", request: REQUEST });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/assistant/relay/next?job=job%201&world=${WORLD}`);
  });

  it("takes no ticket whose engine is not the server's object", async () => {
    for (const engine of ["cloud", null, { provider: "openai" }]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(json({ ok: true, request: { ...REQUEST, engine } })),
      );
      await expect(application.assistant.relayNext("job 1")).resolves.toEqual({ kind: "idle" });
    }
  });

  it("reads 204 as no ticket yet and a 4xx as the end", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(json({ ok: false }, 410))
        .mockResolvedValueOnce(json({ ok: false }, 401)),
    );
    expect(await application.assistant.relayNext("job")).toEqual({ kind: "idle" });
    expect(await application.assistant.relayNext("job")).toEqual({ kind: "ended", status: 410 });
    expect(await application.assistant.relayNext("job")).toEqual({ kind: "ended", status: 401 });
  });

  it("throws on a server error so the loop retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ok: false }, 503)));
    await expect(application.assistant.relayNext("job")).rejects.toThrow("HTTP 503");
  });

  it("never trusts a ticket's limit above the server's 256 KiB", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ ok: true, request: { ...REQUEST, limits: { maxOutputBytes: 10_000_000 } } }),
        ),
    );
    const next = await application.assistant.relayNext("job");
    expect(next.kind === "request" && next.request.limits.maxOutputBytes).toBe(262_144);
  });

  it("posts the answer with its ticket and seq into the selected world", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const answer = {
      ticket: "t1",
      seq: 3,
      output: { content: "{}", finishReason: "stop" as const },
    };
    expect(await application.assistant.relayAnswer(answer)).toEqual({ kind: "ok" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/assistant/relay/answer?world=${WORLD}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(answer);
  });

  it("creates a job with its engine, and without one for the server", async () => {
    const job = {
      id: "job-1",
      status: "queued",
      progressId: null,
      result: null,
      error: "",
      errorType: "",
      httpStatus: null,
      interactionId: null,
      cancelRequested: false,
      createdAt: "2026-11-10T08:00:00+00:00",
      startedAt: null,
      finishedAt: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ ok: true, created: true, job: { ...job, status: "cancelled" } }));
    vi.stubGlobal("fetch", fetchMock);
    const ask = (engine?: { kind: "cloud"; provider: string }) =>
      application.assistant
        .chat("Frage", [], undefined, undefined, undefined, "key", undefined, engine)
        .catch(() => undefined);
    await ask({ kind: "cloud", provider: "openai" });
    await ask();
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[0].engine).toEqual({ kind: "cloud", provider: "openai" });
    expect("engine" in bodies[1]).toBe(false);
  });
});
