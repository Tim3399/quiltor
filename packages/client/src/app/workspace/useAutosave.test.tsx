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
    await act(async () => result.current.retry());
    expect(save).toHaveBeenLastCalledWith(draft);
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
});
