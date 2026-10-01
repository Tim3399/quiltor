import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ApplicationGatewayError } from "../../platform";
import { useAutosave } from "./useAutosave";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

afterEach(() => vi.useRealTimers());

describe("explicit autosave flush", () => {
  it.each([
    new TypeError("Network connection failed"),
    new ApplicationGatewayError("Document revision changed", "document.conflict", {
      category: "conflict",
    }),
  ])("rejects failed saves and keeps the current draft retryable: %s", async (failure) => {
    const save = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    const draft = { body: "unsaved" };
    rerender({ value: draft });
    await act(async () => {
      await expect(result.current.flush()).rejects.toBe(failure);
    });
    expect(result.current.phase).toBe("error");
    const latestDraft = { body: "edited after failure" };
    rerender({ value: latestDraft });
    await act(async () => result.current.retry());
    expect(save).toHaveBeenLastCalledWith(latestDraft);
    expect(result.current.phase).toBe("saved");
  });

  it("finishes edits made during a pending flush before allowing its continuation", async () => {
    let finish!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    rerender({ value: { body: "first edit" } });
    let flushed!: Promise<void>;
    await act(async () => {
      flushed = result.current.flush();
    });
    const latest = { body: "edit while saving" };
    rerender({ value: latest });
    await act(async () => {
      finish();
      await flushed;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(latest);
    expect(result.current.phase).toBe("saved");
  });

  it("handles background save rejection without an unhandled promise", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(new Error("Server unavailable"));
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save, 25), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    rerender({ value: { body: "draft" } });
    await act(async () => vi.advanceTimersByTimeAsync(25));
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Server unavailable");
  });

  it("never reports success while every retry still rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    rerender({ value: { body: "latest draft" } });
    await act(async () => result.current.retry());
    await act(async () => result.current.retry());
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("error");
    expect(result.current.savedAt).toBeNull();
  });

  it("persists edits made while an explicit conflict resolution is saving", async () => {
    let finish!: () => void;
    const save = vi.fn().mockResolvedValue(undefined);
    const saveExpected = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    const reviewed = { body: "reviewed draft" };
    rerender({ value: reviewed });
    let resolving!: Promise<void>;
    await act(async () => {
      resolving = result.current.resolve(reviewed, saveExpected);
    });
    const latest = { body: "typed during save" };
    rerender({ value: latest });
    await act(async () => {
      finish();
      await resolving;
    });
    expect(saveExpected).toHaveBeenCalledWith(reviewed);
    expect(save).toHaveBeenLastCalledWith(latest);
    expect(result.current.phase).toBe("saved");
  });

  it("rejects stale replacement and suppresses autosave for an accepted persisted snapshot", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save, 25), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    const reviewed = { body: "reviewed draft" };
    rerender({ value: reviewed });
    const newer = { body: "newer draft" };
    rerender({ value: newer });
    expect(result.current.replace(reviewed, { body: "persisted" })).toBe(false);

    const persisted = { body: "persisted" };
    expect(result.current.replace(newer, persisted)).toBe(true);
    rerender({ value: persisted });
    await act(async () => vi.advanceTimersByTimeAsync(25));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("saved");
  });
});
