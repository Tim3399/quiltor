import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantRelayGateway,
  RelayAnswered,
  RelayAnswerV1,
  RelayNext,
  RelayRequestV1,
} from "../../platform";
import type { ClientEngineExecutor, ClientEngineResult } from "./engines/types";
import { relayAnswerFor, runRelayLoop, useRelayLoop } from "./useRelayLoop";

function ticket(seq: number, maxOutputBytes = 262_144): RelayRequestV1 {
  return {
    ticket: `t${seq}`,
    seq,
    engine: { kind: "cloud", grammar: false, provider: "openai" },
    payload: { messages: [{ role: "user", content: `Runde ${seq}` }] },
    limits: { maxOutputBytes, answerBySeconds: 60 },
  };
}

/** A relay that hands out the given `next` answers in order, then ends with `final`. */
function scriptedRelay(nexts: RelayNext[], answers: RelayAnswered[] = [], final = 404) {
  const sent: RelayAnswerV1[] = [];
  const relay: AssistantRelayGateway = {
    relayNext: vi.fn(
      async (): Promise<RelayNext> => nexts.shift() ?? { kind: "ended", status: final },
    ),
    relayAnswer: vi.fn(async (answer: RelayAnswerV1): Promise<RelayAnswered> => {
      sent.push(answer);
      return answers.shift() ?? { kind: "ok" };
    }),
  };
  return { relay, sent };
}

function executor(...results: ClientEngineResult[]): ClientEngineExecutor {
  return {
    execute: vi.fn(
      async (): Promise<ClientEngineResult> =>
        results.shift() ?? { content: "", finishReason: "stop" },
    ),
  };
}

const stop = (content: string): ClientEngineResult => ({ content, finishReason: "stop" });

describe("relay loop", () => {
  it("answers one round and ends when the job is gone", async () => {
    const { relay, sent } = scriptedRelay([{ kind: "request", request: ticket(1) }]);
    const engine = executor(stop("{}"));
    const end = await runRelayLoop({
      jobId: "job",
      executor: engine,
      relay,
      signal: new AbortController().signal,
    });
    expect(end).toBe("ended");
    expect(engine.execute).toHaveBeenCalledWith(ticket(1).payload, expect.any(AbortSignal));
    expect(sent).toEqual([
      { ticket: "t1", seq: 1, output: { content: "{}", finishReason: "stop" } },
    ]);
    expect(relay.relayNext).toHaveBeenCalledWith("job", expect.any(AbortSignal));
  });

  it("echoes each ticket's seq over two rounds and waits through an idle poll", async () => {
    const { relay, sent } = scriptedRelay([
      { kind: "request", request: ticket(1) },
      { kind: "idle" },
      { kind: "request", request: ticket(2) },
    ]);
    await runRelayLoop({
      jobId: "job",
      executor: executor(stop("a"), stop("b")),
      relay,
      signal: new AbortController().signal,
    });
    expect(sent.map((answer) => [answer.ticket, answer.seq])).toEqual([
      ["t1", 1],
      ["t2", 2],
    ]);
  });

  it("stops at once on 401, from next or from answer", async () => {
    const fromNext = scriptedRelay([{ kind: "ended", status: 401 }]);
    expect(
      await runRelayLoop({
        jobId: "job",
        executor: executor(),
        relay: fromNext.relay,
        signal: new AbortController().signal,
      }),
    ).toBe("unauthorized");

    const fromAnswer = scriptedRelay(
      [
        { kind: "request", request: ticket(1) },
        { kind: "request", request: ticket(2) },
      ],
      [{ kind: "ended", status: 401 }],
    );
    const engine = executor(stop("a"), stop("b"));
    expect(
      await runRelayLoop({
        jobId: "job",
        executor: engine,
        relay: fromAnswer.relay,
        signal: new AbortController().signal,
      }),
    ).toBe("unauthorized");
    expect(engine.execute).toHaveBeenCalledTimes(1);
  });

  it("ends on 410 and does not run the engine again", async () => {
    const { relay } = scriptedRelay(
      [
        { kind: "request", request: ticket(1) },
        { kind: "request", request: ticket(2) },
      ],
      [{ kind: "ended", status: 410 }],
    );
    const engine = executor(stop("a"), stop("b"));
    const end = await runRelayLoop({
      jobId: "job",
      executor: engine,
      relay,
      signal: new AbortController().signal,
    });
    expect(end).toBe("ended");
    expect(engine.execute).toHaveBeenCalledTimes(1);
  });

  it("retries a poll lost on the network", async () => {
    const answers: RelayNext[] = [{ kind: "ended", status: 410 }];
    const relay: AssistantRelayGateway = {
      relayNext: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockImplementation(async () => answers.shift()),
      relayAnswer: vi.fn(),
    };
    const end = await runRelayLoop({
      jobId: "job",
      executor: executor(),
      relay,
      signal: new AbortController().signal,
      retryMs: 1,
    });
    expect(end).toBe("ended");
    expect(relay.relayNext).toHaveBeenCalledTimes(2);
  });

  it("turns an executor that throws into a provider_error answer", async () => {
    const { relay, sent } = scriptedRelay([{ kind: "request", request: ticket(1) }]);
    const engine: ClientEngineExecutor = {
      execute: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    await runRelayLoop({
      jobId: "job",
      executor: engine,
      relay,
      signal: new AbortController().signal,
    });
    expect(sent).toEqual([
      { ticket: "t1", seq: 1, error: { code: "provider_error", detail: "network down" } },
    ]);
  });
});

describe("idle polls (F-61-24)", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps at least a second between polls the server answers at once", async () => {
    // After a job ends the server answers relay/next with 204 at once until the page stops
    // the loop, which happens only when its job polling sees the end (about a second).
    vi.useFakeTimers();
    const relay: AssistantRelayGateway = {
      // Answered 10 ms later: fast enough to flood without the floor, slow enough to keep
      // the event loop turning, so a regression fails the count instead of hanging the worker.
      relayNext: vi.fn(async (): Promise<RelayNext> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { kind: "idle" };
      }),
      relayAnswer: vi.fn(),
    };
    const controller = new AbortController();
    const loop = runRelayLoop({
      jobId: "job",
      executor: executor(),
      relay,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    controller.abort();
    // Lets the poll in flight come back so the loop can see the abort.
    await vi.advanceTimersByTimeAsync(100);
    expect(await loop).toBe("aborted");
    // One poll at the start and one per elapsed second: 11, never thousands.
    expect(vi.mocked(relay.relayNext).mock.calls.length).toBeLessThanOrEqual(11);
  });

  it("never waits longer than the floor when the clock is set back during a poll", async () => {
    // The wall clock jumps an hour back while each poll is out (F-61-26). The pause must come
    // from a monotonic clock and never exceed the floor, or the job misses its pickup deadline.
    vi.useFakeTimers();
    const relay: AssistantRelayGateway = {
      relayNext: vi.fn(async (): Promise<RelayNext> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        vi.setSystemTime(Date.now() - 3_600_000);
        return { kind: "idle" };
      }),
      relayAnswer: vi.fn(),
    };
    const controller = new AbortController();
    const loop = runRelayLoop({
      jobId: "job",
      executor: executor(),
      relay,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(await loop).toBe("aborted");
    // One poll at the start and one per second: an hour-long sleep would leave just one.
    expect(vi.mocked(relay.relayNext).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not wait after a long poll that held its full time", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const relay: AssistantRelayGateway = {
      relayNext: vi.fn(async (): Promise<RelayNext> => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 25_000));
          return { kind: "idle" };
        }
        return { kind: "ended", status: 410 };
      }),
      relayAnswer: vi.fn(),
    };
    const loop = runRelayLoop({
      jobId: "job",
      executor: executor(),
      relay,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(25_000);
    // The second poll starts right after the first, without the one-second floor.
    expect(await loop).toBe("ended");
    expect(calls).toBe(2);
  });

  it("starts a waiting ticket at once", async () => {
    vi.useFakeTimers();
    const { relay } = scriptedRelay([{ kind: "request", request: ticket(1) }]);
    const engine = executor(stop("{}"));
    const loop = runRelayLoop({
      jobId: "job",
      executor: engine,
      relay,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.execute).toHaveBeenCalledTimes(1);
    expect(await loop).toBe("ended");
  });
});

describe("answer size", () => {
  it("sends an answer that fits and refuses one larger than the server takes", () => {
    const small = relayAnswerFor(ticket(1, 1000), stop("x".repeat(900)));
    expect(small).toEqual({
      ticket: "t1",
      seq: 1,
      output: { content: "x".repeat(900), finishReason: "stop" },
    });
    const large = relayAnswerFor(ticket(1, 1000), stop("x".repeat(1000)));
    expect(large).toEqual({
      ticket: "t1",
      seq: 1,
      error: { code: "provider_error", detail: "output too large" },
    });
  });

  it("counts bytes, not characters, at the real limit of 256 KiB", async () => {
    // 100 000 umlauts are 200 000 bytes and fit; 140 000 are 280 000 bytes and do not.
    const { relay, sent } = scriptedRelay([
      { kind: "request", request: ticket(1) },
      { kind: "request", request: ticket(2) },
    ]);
    await runRelayLoop({
      jobId: "job",
      executor: executor(stop("ä".repeat(100_000)), stop("ä".repeat(140_000))),
      relay,
      signal: new AbortController().signal,
    });
    expect("output" in sent[0]).toBe(true);
    expect(sent[1]).toEqual({
      ticket: "t2",
      seq: 2,
      error: { code: "provider_error", detail: "output too large" },
    });
  });
});

describe("cancel", () => {
  it("aborts the engine and answers the open ticket with cancelled", async () => {
    let engineSignal: AbortSignal | undefined;
    const engine: ClientEngineExecutor = {
      execute: vi.fn(
        (_payload, signal: AbortSignal) =>
          new Promise<ClientEngineResult>((resolve) => {
            engineSignal = signal;
            signal.addEventListener("abort", () => resolve(stop("too late")));
          }),
      ),
    };
    const { relay, sent } = scriptedRelay([{ kind: "request", request: ticket(7) }]);
    const { result } = renderHook(() => useRelayLoop(relay));
    let ended: Promise<string> | undefined;
    act(() => {
      ended = result.current.start("job", engine);
    });
    await waitFor(() => expect(engine.execute).toHaveBeenCalled());

    await act(async () => result.current.cancel());

    expect(engineSignal?.aborted).toBe(true);
    expect(await ended).toBe("aborted");
    // Only the cancellation reaches the server, never the aborted engine's late text.
    expect(sent).toEqual([{ ticket: "t7", seq: 7, error: { code: "cancelled" } }]);
  });

  it("sends nothing when no ticket is open", async () => {
    const { relay, sent } = scriptedRelay([]);
    const { result } = renderHook(() => useRelayLoop(relay));
    await act(async () => result.current.cancel());
    expect(sent).toEqual([]);
  });
});
