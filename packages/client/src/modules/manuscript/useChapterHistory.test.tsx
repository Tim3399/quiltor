import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chapter } from "./model";

const history = vi.hoisted(() => ({ log: vi.fn(), chapterComparison: vi.fn() }));

vi.mock("../../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform")>()),
  quiltorClient: { application: { history } },
}));

import { useChapterHistory } from "./useChapterHistory";

const chapterA: Chapter = { id: "a", title: "Eins", body: "Alt", note: "" };
const chapterB: Chapter = { id: "b", title: "Zwei", body: "Neu", note: "" };
const record = { available: true, text: "Text", marks: [] };

beforeEach(() => {
  vi.useFakeTimers();
  history.log.mockResolvedValue({ commits: [{ hash: "h1" }] });
  history.chapterComparison.mockImplementation((_ref: string, id: string) =>
    id === "b" ? new Promise(() => {}) : Promise.resolve({ selected: record, previous: record }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useChapterHistory", () => {
  it("drops a loaded comparison when the chapter changes and does not bring it back", async () => {
    let chapter = chapterA;
    const { result, rerender } = renderHook(() => useChapterHistory(chapter));
    act(() => result.current.setOpen(true));
    await settle(0);
    await settle(400);
    expect(result.current.snapshotReady).toBe(true);
    expect(result.current.selected).not.toBeNull();

    chapter = chapterB;
    rerender();
    expect(result.current.snapshotReady).toBe(false);
    expect(result.current.selected).toBeNull();
    expect(result.current.state).toBe("loading");
    await settle(400);

    // Chapter B's comparison is still pending: going back to A must not show A's old data.
    chapter = chapterA;
    rerender();
    expect(result.current.snapshotReady).toBe(false);
    expect(result.current.selected).toBeNull();

    await settle(400);
    expect(result.current.snapshotReady).toBe(true);
  });

  it("reloads a snapshot it has left instead of reusing the comparison it still holds", async () => {
    history.log.mockResolvedValue({ commits: [{ hash: "h1" }, { hash: "h2" }] });
    history.chapterComparison.mockImplementation((ref: string) =>
      ref === "h2"
        ? new Promise(() => {})
        : Promise.resolve({ selected: record, previous: record }),
    );
    const { result } = renderHook(() => useChapterHistory(chapterA));
    act(() => result.current.setOpen(true));
    await settle(0);
    await settle(400);
    expect(result.current.snapshotReady).toBe(true);

    act(() => result.current.setSelectedRef("h2"));
    await settle(400);
    act(() => result.current.setSelectedRef("h1"));

    expect(result.current.snapshotReady).toBe(false);
    expect(result.current.state).toBe("loading");
    await settle(400);
    expect(result.current.snapshotReady).toBe(true);
  });

  it("starts from an empty list each time the history is opened", async () => {
    const { result } = renderHook(() => useChapterHistory(chapterA));
    act(() => result.current.setOpen(true));
    await settle(0);
    expect(result.current.commits).toHaveLength(1);

    act(() => result.current.setOpen(false));
    history.log.mockReturnValue(new Promise(() => {}));
    act(() => result.current.setOpen(true));

    expect(result.current.commits).toHaveLength(0);
    expect(result.current.selectedRef).toBe("");
    expect(result.current.state).toBe("loading");
  });
});
