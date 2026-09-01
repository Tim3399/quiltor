import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHistoryState } from "./useHistoryState";

describe("useHistoryState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("macht gruppierte Änderungen rückgängig und wiederholt sie", () => {
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

  it("hält einen diskreten Schritt von schnellen Texteingaben davor und danach getrennt", () => {
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

  it("legt auch direkt nach dem Laden einen diskreten Schritt separat ab", () => {
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
});
