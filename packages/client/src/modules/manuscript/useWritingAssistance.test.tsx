import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ApplicationGatewayError } from "../../platform";
import type { Chapter, Manuscript } from "./model";
import type { WorkspaceSelection } from "./workspaceTypes";

const assistance = vi.hoisted(() => ({
  status: vi.fn(),
  checkGrammar: vi.fn(),
}));

vi.mock("../../platform", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../platform")>();
  return {
    ...original,
    quiltorClient: {
      ...original.quiltorClient,
      application: { ...original.quiltorClient.application, writingAssistance: assistance },
    },
  };
});

import { useWritingAssistance } from "./useWritingAssistance";

const manuscript: Manuscript = { chapters: [] };
const figures = { nodes: [], edges: [] };

beforeEach(() => {
  assistance.status.mockResolvedValue({
    installed: false,
    grammar: { supported: true, available: true },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function setup(initial: { selectionKey: string; current: Chapter }) {
  return renderHook(
    (props: { selectionKey: string; current: Chapter }) =>
      useWritingAssistance({
        ...props,
        manuscript,
        figures,
        onChange: vi.fn(),
        onUpdateCurrent: vi.fn(),
        onInspectorOpen: vi.fn(),
        onShowWritingAid: vi.fn(),
        onError: vi.fn(),
      }),
    { wrapper, initialProps: initial },
  );
}

const chapter = (body: string): Chapter => ({ id: "c1", title: "Eins", body, note: "" });
const selectionOf = (body: string, from: number, text: string): WorkspaceSelection =>
  ({ chapterId: "c1", revision: body, from, to: from + text.length, text }) as WorkspaceSelection;

describe("useWritingAssistance", () => {
  it("drops everything bound to a selection when the edited item changes", async () => {
    const body = "Hafen und Hafen";
    const { result, rerender } = setup({ selectionKey: "a", current: chapter(body) });
    await act(async () => {});
    act(() => result.current.onSelection(selectionOf(body, 0, "Hafen")));
    act(() => result.current.setQuery("von Hand"));
    expect(result.current.selection).not.toBeNull();
    expect(result.current.query).toBe("von Hand");

    rerender({ selectionKey: "b", current: chapter(body) });

    expect(result.current.selection).toBeNull();
    expect(result.current.query).toBe("");
  });

  it("refills the query from a live selection, also when the same text is selected elsewhere", async () => {
    const body = "Hafen und Hafen";
    const { result } = setup({ selectionKey: "a", current: chapter(body) });
    await act(async () => {});

    act(() => result.current.onSelection(selectionOf(body, 0, "Hafen")));
    expect(result.current.query).toBe("Hafen");

    act(() => result.current.setQuery("von Hand"));
    act(() => result.current.onSelection(selectionOf(body, 10, "Hafen")));
    expect(result.current.query).toBe("Hafen");
  });

  it("aborts a running grammar check when the edited item changes", async () => {
    assistance.checkGrammar.mockReturnValue(new Promise(() => {}));
    const { result, rerender } = setup({ selectionKey: "a", current: chapter("Alt") });
    await act(async () => {});
    act(() => result.current.checkGrammar());
    const signal = assistance.checkGrammar.mock.calls[0][2] as AbortSignal;
    expect(signal.aborted).toBe(false);

    rerender({ selectionKey: "b", current: chapter("Alt") });

    expect(signal.aborted).toBe(true);
  });

  it("drops a grammar result when the chapter text changed while it was checked", async () => {
    let resolveCheck: (value: { issues: never[] }) => void = () => {};
    assistance.checkGrammar.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const { result, rerender } = setup({ selectionKey: "a", current: chapter("Alt") });
    await act(async () => {});
    act(() => result.current.checkGrammar());
    expect(result.current.grammarPhase).toBe("checking");

    rerender({ selectionKey: "a", current: chapter("Neu") });
    await act(async () => resolveCheck({ issues: [] }));

    expect(result.current.grammarPhase).toBe("checking");
  });

  it("rides out a 429 silently and checks the newest text once after the pause", async () => {
    const issue = { id: "i1", from: 0, to: 3, message: "m", replacements: [] };
    assistance.checkGrammar.mockResolvedValueOnce({ issues: [issue] });
    const { result, rerender } = setup({ selectionKey: "a", current: chapter("Alt") });
    await act(async () => {});
    await act(async () => result.current.checkGrammar());
    expect(result.current.grammarIssues).toHaveLength(1);

    vi.useFakeTimers();
    try {
      assistance.checkGrammar.mockRejectedValueOnce(
        new ApplicationGatewayError("busy", "writing_assistance.rate_limited", {
          retryable: true,
          params: { retryAfter: 2 },
        }),
      );
      await act(async () => result.current.checkGrammar());
      expect(result.current.grammarPhase).toBe("idle");
      expect(result.current.grammarError).toBe("");
      expect(result.current.grammarIssues).toHaveLength(1);

      rerender({ selectionKey: "a", current: chapter("Alt") });
      assistance.checkGrammar.mockResolvedValueOnce({ issues: [] });
      await act(async () => vi.advanceTimersByTime(1999));
      expect(assistance.checkGrammar).toHaveBeenCalledTimes(2);
      await act(async () => vi.advanceTimersByTime(1));
      expect(assistance.checkGrammar).toHaveBeenCalledTimes(3);
      await act(async () => vi.advanceTimersByTime(10_000));
      expect(assistance.checkGrammar).toHaveBeenCalledTimes(3);
      expect(result.current.grammarIssues).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
