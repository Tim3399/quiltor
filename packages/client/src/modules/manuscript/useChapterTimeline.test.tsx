import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterTimelineEntry, ChapterTimelinePage } from "../../platform";

const history = vi.hoisted(() => ({ chapterTimeline: vi.fn() }));

vi.mock("../../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform")>()),
  quiltorClient: { application: { history } },
}));

import { CHAPTER_TIMELINE_PAGE, useChapterTimeline } from "./useChapterTimeline";

function entry(
  hash: string,
  change: ChapterTimelineEntry["change"] = "edited",
): ChapterTimelineEntry {
  return {
    hash: hash.repeat(64).slice(0, 64),
    shortHash: hash.repeat(8).slice(0, 8),
    date: "2026-11-07T18:16:00",
    subject: hash,
    kind: "manual",
    change,
  };
}

function page(
  entries: ChapterTimelineEntry[],
  next: string | null,
  skipped = 0,
): ChapterTimelinePage {
  return { entries, skipped, next };
}

const selection = { selectedRef: "", setSelectedRef: vi.fn() };

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  history.chapterTimeline.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useChapterTimeline", () => {
  it("appends the next page and stops when next is null", async () => {
    history.chapterTimeline
      .mockResolvedValueOnce(page([entry("a"), entry("b")], "b".repeat(64), 1))
      .mockResolvedValueOnce(page([entry("c", "created")], null, 2));
    const { result } = renderHook(() => useChapterTimeline("x", true, selection));
    await flush();

    expect(result.current.entries.map((item) => item.subject)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(true);
    expect(history.chapterTimeline).toHaveBeenLastCalledWith(
      "x",
      expect.objectContaining({ limit: CHAPTER_TIMELINE_PAGE }),
    );
    expect(history.chapterTimeline.mock.calls[0]?.[1]).not.toHaveProperty("before");

    act(() => result.current.loadMore());
    await flush();

    expect(history.chapterTimeline).toHaveBeenLastCalledWith(
      "x",
      expect.objectContaining({ before: "b".repeat(64) }),
    );
    expect(result.current.entries.map((item) => item.subject)).toEqual(["a", "b", "c"]);
    expect(result.current.skipped).toBe(3);
    expect(result.current.hasMore).toBe(false);

    act(() => result.current.loadMore());
    await flush();
    expect(history.chapterTimeline).toHaveBeenCalledTimes(2);
  });

  it("aborts a running request on a chapter change and drops its answer", async () => {
    let answerA: (value: ChapterTimelinePage) => void = () => {};
    history.chapterTimeline.mockImplementation((id: string) =>
      id === "a"
        ? new Promise<ChapterTimelinePage>((resolve) => {
            answerA = resolve;
          })
        : Promise.resolve(page([entry("b")], null)),
    );
    let chapter = "a";
    const { result, rerender } = renderHook(() => useChapterTimeline(chapter, true, selection));
    const signal = history.chapterTimeline.mock.calls[0]?.[1]?.signal as AbortSignal;

    chapter = "b";
    rerender();
    await flush();
    expect(signal.aborted).toBe(true);
    expect(result.current.entries.map((item) => item.subject)).toEqual(["b"]);

    answerA(page([entry("a")], null));
    await flush();
    expect(result.current.entries.map((item) => item.subject)).toEqual(["b"]);
  });

  it("aborts a running request when the timeline closes and keeps nothing from it", async () => {
    let answer: (value: ChapterTimelinePage) => void = () => {};
    history.chapterTimeline.mockImplementation(
      () =>
        new Promise<ChapterTimelinePage>((resolve) => {
          answer = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useChapterTimeline("x", enabled, selection),
      { initialProps: { enabled: true } },
    );
    const signal = history.chapterTimeline.mock.calls[0]?.[1]?.signal as AbortSignal;

    rerender({ enabled: false });
    expect(signal.aborted).toBe(true);
    answer(page([entry("a")], null));
    await flush();
    expect(result.current.entries).toEqual([]);
  });

  it("reports a failed page and loads it again on retry", async () => {
    history.chapterTimeline
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([entry("a")], null));
    const { result } = renderHook(() => useChapterTimeline("x", true, selection));
    await flush();
    expect(result.current.state).toBe("error");

    act(() => result.current.retry());
    await flush();
    expect(result.current.state).toBe("idle");
    expect(result.current.entries).toHaveLength(1);
  });

  it("asks for nothing while closed and hands the choice to the shared selection", async () => {
    const setSelectedRef = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => useChapterTimeline("x", enabled, { selectedRef: "h", setSelectedRef }),
      { initialProps: { enabled: false } },
    );
    await flush();
    expect(history.chapterTimeline).not.toHaveBeenCalled();

    history.chapterTimeline.mockResolvedValue(page([entry("a")], null));
    rerender({ enabled: true });
    await flush();
    act(() => result.current.select("a".repeat(64)));
    expect(setSelectedRef).toHaveBeenCalledWith("a".repeat(64));
    expect(result.current.selectedRef).toBe("h");
  });
});
