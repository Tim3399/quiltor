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

  it("lets the debounce timer save through the save function of the latest render", async () => {
    vi.useFakeTimers();
    const first = vi.fn().mockResolvedValue(undefined);
    const latest = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ value, save }) => useAutosave(value, save, 25), {
      initialProps: { value: { body: "saved" }, save: first },
      wrapper,
    });
    const draft = { body: "draft" };
    rerender({ value: draft, save: first });
    rerender({ value: draft, save: latest });

    await act(async () => vi.advanceTimersByTimeAsync(25));

    expect(latest).toHaveBeenCalledWith(draft);
    expect(first).not.toHaveBeenCalled();
  });

  // F-17-6: replace() hands over the server-confirmed value, and callers go on with it before
  // React renders again. resolve() and a second replace() must compare against `persisted`.
  it("resolves the persisted value right after a replace, without a render in between", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saveExpected = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    const draft = { body: "draft" };
    rerender({ value: draft });
    const persisted = { body: "persisted" };

    let replaced = false;
    await act(async () => {
      replaced = result.current.replace(draft, persisted);
      await result.current.resolve(persisted, saveExpected);
    });

    expect(replaced).toBe(true);
    expect(saveExpected).toHaveBeenCalledWith(persisted);
    expect(result.current.error).not.toMatch(/geändert|changed/i);
    expect(result.current.phase).toBe("saved");
  });

  it("accepts a second replace of the persisted value right after the first", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    const draft = { body: "draft" };
    rerender({ value: draft });
    const persisted = { body: "persisted" };
    const next = { body: "next" };

    let first = false;
    let second = false;
    act(() => {
      first = result.current.replace(draft, persisted);
      second = result.current.replace(persisted, next);
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it("does not save a value it was told is loaded, nor the first value after discard (b′)", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save, 25), {
      initialProps: { value: { body: "first load" } },
      wrapper,
    });
    const reloaded = { body: "second load" };
    result.current.accept(reloaded);
    rerender({ value: reloaded });
    await act(async () => vi.advanceTimersByTimeAsync(25));
    expect(result.current.isDirty()).toBe(false);
    expect(save).not.toHaveBeenCalled();

    act(() => {
      expect(result.current.discard()).toBe(true);
    });
    rerender({ value: { body: "another world" } });
    await act(async () => vi.advanceTimersByTimeAsync(25));
    expect(result.current.isDirty()).toBe(false);
    expect(save).not.toHaveBeenCalled();

    rerender({ value: { body: "an edit" } });
    await act(async () => vi.advanceTimersByTimeAsync(25));
    expect(save).toHaveBeenCalledOnce();
  });
});

describe("save failure reporting", () => {
  const failure = () =>
    new ApplicationGatewayError("Ungültige Anfrage", "document.invalid_wire", {
      category: "invalid_request",
      requestId: "k3f9q2m8x1c7v4za",
    });

  it("warns with code and request id and exposes the id after a failed flush", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = failure();
    const save = vi.fn().mockRejectedValue(error);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    rerender({ value: { body: "unsaved" } });
    await act(async () => {
      await expect(result.current.flush()).rejects.toBe(error);
    });
    expect(warn).toHaveBeenCalledWith("save failed", {
      code: "document.invalid_wire",
      requestId: "k3f9q2m8x1c7v4za",
    });
    expect(result.current.errorId).toBe("k3f9q2m8x1c7v4za");
    warn.mockRestore();
  });

  it("warns when an explicit resolution fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = failure();
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave(value, vi.fn().mockResolvedValue(undefined)),
      { initialProps: { value: { body: "saved" } }, wrapper },
    );
    const reviewed = { body: "reviewed" };
    rerender({ value: reviewed });
    await act(async () => {
      await expect(result.current.resolve(reviewed, vi.fn().mockRejectedValue(error))).rejects.toBe(
        error,
      );
    });
    expect(warn).toHaveBeenCalledWith("save failed", {
      code: "document.invalid_wire",
      requestId: "k3f9q2m8x1c7v4za",
    });
    expect(result.current.errorId).toBe("k3f9q2m8x1c7v4za");
    warn.mockRestore();
  });

  it("warns without a request id for failures that are not gateway errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const save = vi.fn().mockRejectedValue(new TypeError("Network connection failed"));
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save), {
      initialProps: { value: { body: "saved" } },
      wrapper,
    });
    rerender({ value: { body: "unsaved" } });
    await act(async () => result.current.retry());
    expect(warn).toHaveBeenCalledWith("save failed", { code: "unknown", requestId: undefined });
    expect(result.current.errorId).toBeUndefined();
    warn.mockRestore();
  });
});
