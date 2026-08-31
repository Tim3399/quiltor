import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDefaultStoryboardState, type StoryboardState } from "../../modules/storyboard";
import { quiltorClient } from "../../platform";
import { useAutosave } from "./useAutosave";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Storyboard autosave lane", () => {
  it("coalesces Storyboard changes into the Storyboard gateway only", async () => {
    const saveStoryboards = vi
      .spyOn(quiltorClient.application.storyboards, "save")
      .mockResolvedValue({ ok: true, zeit: "2026-08-30T12:00:00.000Z", revision: 1 });
    const saveManuscript = vi.spyOn(quiltorClient.application.manuscript, "save");
    const saveStoryWorld = vi.spyOn(quiltorClient.application.storyWorld, "save");
    const initial = createDefaultStoryboardState();
    const { result, rerender } = renderHook(
      ({ value }: { value: StoryboardState }) =>
        useAutosave(value, (next) => quiltorClient.application.storyboards.save(next), 25),
      { initialProps: { value: initial }, wrapper },
    );

    expect(result.current.phase).toBe("idle");
    const changed: StoryboardState = {
      ...initial,
      nodes: [
        {
          id: "note-1",
          boardId: "main-storyboard",
          kind: "note",
          x: 120,
          y: 80,
          text: "Eine freie Idee",
        },
      ],
    };
    rerender({ value: changed });
    expect(result.current.phase).toBe("dirty");

    await act(async () => vi.advanceTimersByTimeAsync(25));

    expect(saveStoryboards).toHaveBeenCalledOnce();
    expect(saveStoryboards).toHaveBeenCalledWith(changed);
    expect(saveManuscript).not.toHaveBeenCalled();
    expect(saveStoryWorld).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("saved");
  });

  it("retries the latest dirty value after an earlier save rejected", async () => {
    const save = vi
      .fn<(value: StoryboardState) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Vorübergehend nicht erreichbar"))
      .mockResolvedValueOnce({ ok: true });
    const initial = createDefaultStoryboardState();
    const changed: StoryboardState = {
      ...initial,
      nodes: [
        {
          id: "note-retry",
          boardId: "main-storyboard",
          kind: "note",
          x: 80,
          y: 60,
          text: "Bleibt ungespeichert, bis der Retry gelingt",
        },
      ],
    };
    const { result, rerender } = renderHook(
      ({ value }: { value: StoryboardState }) => useAutosave(value, save, 25),
      { initialProps: { value: initial }, wrapper },
    );

    rerender({ value: changed });
    await act(async () => vi.advanceTimersByTimeAsync(25));

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Vorübergehend nicht erreichbar");

    await act(async () => result.current.retry());

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(changed);
    expect(result.current.phase).toBe("saved");
    expect(result.current.error).toBe("");
  });
});
