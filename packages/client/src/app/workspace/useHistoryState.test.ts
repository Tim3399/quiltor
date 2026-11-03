import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHistoryState } from "./useHistoryState";

describe("useHistoryState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("undoes grouped changes and redoes them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useHistoryState<{ text: string }>());
    act(() => result.current.load({ text: "Anfang" }));
    act(() => result.current.change({ text: "Erste Änderung" }));
    act(() => result.current.change({ text: "Erste Änderung, weitergeschrieben" }));
    expect(result.current.value?.text).toBe("Erste Änderung, weitergeschrieben");
    act(() => result.current.undo());
    expect(result.current.value?.text).toBe("Anfang");
    act(() => result.current.redo());
    expect(result.current.value?.text).toBe("Erste Änderung, weitergeschrieben");
  });

  it("keeps a discrete step separate from fast typing before and after it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useHistoryState<{ text: string }>());

    act(() => result.current.load({ text: "Anfang" }));
    act(() => result.current.change({ text: "Schnelle Eingabe" }));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.change({ text: "Toolbar-Kommando" }, { separateHistoryStep: true }));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.change({ text: "Text nach Kommando" }));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.change({ text: "Text nach Kommando, weiter" }));

    act(() => result.current.undo());
    expect(result.current.value?.text).toBe("Toolbar-Kommando");
    act(() => result.current.undo());
    expect(result.current.value?.text).toBe("Schnelle Eingabe");
    act(() => result.current.undo());
    expect(result.current.value?.text).toBe("Anfang");

    act(() => result.current.redo());
    expect(result.current.value?.text).toBe("Schnelle Eingabe");
    act(() => result.current.redo());
    expect(result.current.value?.text).toBe("Toolbar-Kommando");
    act(() => result.current.redo());
    expect(result.current.value?.text).toBe("Text nach Kommando, weiter");
  });

  it("records a discrete step separately even right after loading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { result } = renderHook(() => useHistoryState<{ text: string }>());

    act(() => result.current.load({ text: "Anfang" }));
    act(() => result.current.change({ text: "Kommando" }, { separateHistoryStep: true }));
    act(() => result.current.change({ text: "Danach geschrieben" }));

    act(() => result.current.undo());
    expect(result.current.value?.text).toBe("Kommando");
    act(() => result.current.undo());
    expect(result.current.value?.text).toBe("Anfang");
  });

  it("reports whether there is something to undo or redo after every action", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useHistoryState<{ text: string }>());
    const availability = () => [result.current.canUndo, result.current.canRedo];

    expect(availability()).toEqual([false, false]);
    act(() => result.current.load({ text: "Anfang" }));
    expect(availability()).toEqual([false, false]);
    act(() => result.current.change({ text: "Eins" }));
    expect(availability()).toEqual([true, false]);
    act(() => result.current.undo());
    expect(availability()).toEqual([false, true]);
    act(() => result.current.redo());
    expect(availability()).toEqual([true, false]);
    act(() => result.current.undo());
    act(() => result.current.change({ text: "Anders" }));
    expect(availability()).toEqual([true, false]);
    act(() => result.current.clear());
    expect(availability()).toEqual([false, false]);
    expect(result.current.value).toBeNull();
  });

  it("forgets the history when another document is loaded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useHistoryState<{ text: string }>());
    act(() => result.current.load({ text: "Anfang" }));
    act(() => result.current.change({ text: "Eins" }));
    act(() => result.current.undo());
    expect([result.current.canUndo, result.current.canRedo]).toEqual([false, true]);

    act(() => result.current.load({ text: "Andere Welt" }));

    expect([result.current.canUndo, result.current.canRedo]).toEqual([false, false]);
  });
});
