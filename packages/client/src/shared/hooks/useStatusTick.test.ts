import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATUS_POLL_MS, useStatusTick } from "./useStatusTick";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("status tick", () => {
  it("runs one interval for several subscribers and stops with the last one", () => {
    const setInterval = vi.spyOn(window, "setInterval");
    const clearInterval = vi.spyOn(window, "clearInterval");
    const first = vi.fn();
    const second = vi.fn();
    const a = renderHook(() => useStatusTick(first));
    const b = renderHook(() => useStatusTick(second));
    expect(setInterval).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(STATUS_POLL_MS);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    a.unmount();
    expect(clearInterval).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STATUS_POLL_MS);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    b.unmount();
    expect(clearInterval).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STATUS_POLL_MS);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("calls the newest callback without subscribing again", () => {
    const setInterval = vi.spyOn(window, "setInterval");
    const first = vi.fn();
    const next = vi.fn();
    const hook = renderHook(({ onTick }) => useStatusTick(onTick), {
      initialProps: { onTick: first },
    });
    hook.rerender({ onTick: next });
    vi.advanceTimersByTime(STATUS_POLL_MS);
    expect(first).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});
