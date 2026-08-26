import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAPTER_OVERSCROLL_REGRIP_GRACE_MS } from "./chapterOverscroll";
import type { Manuscript } from "./model";
import { figures, renderWorkspace } from "./TextWorkspace.testSupport";

const nestedManuscript: Manuscript = {
  chapters: [
    { id: "c1", title: "Prolog", body: "Eins", note: "" },
    { id: "c2", title: "Im Wald", body: "Zwei", note: "" },
    { id: "c3", title: "Rückkehr", body: "Drei", note: "" },
  ],
  structure: {
    folders: [
      { id: "part-one", title: "Teil I" },
      { id: "part-two", title: "Teil II" },
    ],
    items: [
      { id: "c1-item", kind: "chapter", chapterId: "c1", position: 0 },
      { id: "part-one-item", kind: "folder", folderId: "part-one", position: 1 },
      {
        id: "c2-item",
        kind: "chapter",
        chapterId: "c2",
        parentFolderId: "part-one",
        position: 0,
      },
      { id: "part-two-item", kind: "folder", folderId: "part-two", position: 2 },
      {
        id: "c3-item",
        kind: "chapter",
        chapterId: "c3",
        parentFolderId: "part-two",
        position: 0,
      },
    ],
  },
};

function renderNavigation() {
  return renderWorkspace({
    manuscript: nestedManuscript,
    figures,
    onChange: vi.fn(),
    focus: false,
    onFocus: vi.fn(),
  });
}

function editorScroller(container: HTMLElement) {
  const scroller = container.querySelector<HTMLElement>(".editor-scroll");
  if (!scroller) throw new Error("Editor scroller missing");
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 1_000 },
    scrollTop: { configurable: true, value: 800, writable: true },
  });
  return scroller;
}

function immediateAnimationFrames() {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("continuous chapter navigation", () => {
  it("follows the flattened binder order across folder boundaries", () => {
    const view = renderNavigation();
    immediateAnimationFrames();
    const rendered = within(view.container);

    expect(rendered.queryByRole("button", { name: /Vorheriges Kapitel/ })).toBeNull();
    fireEvent.click(
      rendered.getByRole("button", { name: "Nächstes Kapitel: Kapitel 2 · Im Wald" }),
    );
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Im Wald");
    expect(
      rendered.getByRole("button", { name: "Vorheriges Kapitel: Kapitel 1 · Prolog" }),
    ).toBeInTheDocument();

    fireEvent.click(
      rendered.getByRole("button", { name: "Nächstes Kapitel: Kapitel 3 · Rückkehr" }),
    );
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Rückkehr");
    expect(rendered.queryByRole("button", { name: /Nächstes Kapitel/ })).toBeNull();
  });

  it("lands at the top when moving forward and at the bottom when moving backward", () => {
    const view = renderNavigation();
    immediateAnimationFrames();
    const scroller = editorScroller(view.container);
    const rendered = within(view.container);

    fireEvent.click(
      rendered.getByRole("button", { name: "Nächstes Kapitel: Kapitel 2 · Im Wald" }),
    );
    expect(scroller.scrollTop).toBe(0);

    scroller.scrollTop = 120;
    fireEvent.click(
      rendered.getByRole("button", { name: "Vorheriges Kapitel: Kapitel 1 · Prolog" }),
    );
    expect(scroller.scrollTop).toBe(800);
  });

  it("arms on the first bottom event and navigates only after sustained overscroll", () => {
    const view = renderNavigation();
    immediateAnimationFrames();
    const scroller = editorScroller(view.container);
    const rendered = within(view.container);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Prolog");
    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");

    for (now of [150, 300, 450, 600, 750]) fireEvent.wheel(scroller, { deltaY: 24 });
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Prolog");

    now = 850;
    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Im Wald");
    expect(scroller.scrollTop).toBe(0);
  });

  it("keeps mouse-wheel progress while the user briefly re-grips the wheel", () => {
    const view = renderNavigation();
    immediateAnimationFrames();
    const scroller = editorScroller(view.container);
    const rendered = within(view.container);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    fireEvent.wheel(scroller, { deltaY: 24 });
    now = 150;
    fireEvent.wheel(scroller, { deltaY: 24 });
    now = 600;
    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Prolog");

    now = 850;
    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Im Wald");
  });

  it("clears a partially revealed chapter action after wheel input stops", () => {
    vi.useFakeTimers();
    const view = renderNavigation();
    const scroller = editorScroller(view.container);

    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");

    act(() => vi.advanceTimersByTime(CHAPTER_OVERSCROLL_REGRIP_GRACE_MS - 1));
    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");

    act(() => vi.advanceTimersByTime(1));

    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");
  });

  it("supports focus and keyboard-style activation of the explicit action", () => {
    const view = renderNavigation();
    immediateAnimationFrames();
    const scroller = editorScroller(view.container);
    const rendered = within(view.container);

    fireEvent.wheel(scroller, { deltaY: 24 });
    const action = rendered.getByRole("button", {
      name: "Nächstes Kapitel: Kapitel 2 · Im Wald",
    });
    action.focus();
    expect(action).toHaveFocus();

    fireEvent.click(action, { detail: 0 });

    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Im Wald");
    expect(scroller.scrollTop).toBe(0);
  });

  it("cancels pending navigation after leaving the boundary", () => {
    const view = renderNavigation();
    const scroller = editorScroller(view.container);
    const rendered = within(view.container);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    fireEvent.wheel(scroller, { deltaY: 24 });
    now = 150;
    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");

    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");
    now = 1_000;
    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Prolog");
  });

  it("cancels pending navigation when wheel direction reverses", () => {
    const view = renderNavigation();
    const scroller = editorScroller(view.container);
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 200 });
    scroller.scrollTop = 0;

    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");

    fireEvent.wheel(scroller, { deltaY: -24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");
  });

  it("cancels pending navigation even for sub-threshold reverse input", () => {
    const view = renderNavigation();
    const scroller = editorScroller(view.container);

    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");

    fireEvent.wheel(scroller, { deltaY: -1 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");
  });

  it("keeps nonexistent endpoint gestures idle", () => {
    const view = renderNavigation();
    immediateAnimationFrames();
    const scroller = editorScroller(view.container);
    const rendered = within(view.container);

    scroller.scrollTop = 0;
    fireEvent.wheel(scroller, { deltaY: -24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");

    fireEvent.click(
      rendered.getByRole("button", { name: "Nächstes Kapitel: Kapitel 2 · Im Wald" }),
    );
    fireEvent.click(
      rendered.getByRole("button", { name: "Nächstes Kapitel: Kapitel 3 · Rückkehr" }),
    );
    scroller.scrollTop = 800;
    fireEvent.wheel(scroller, { deltaY: 24 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");
  });

  it("ignores pinch zoom and predominantly horizontal wheel input", () => {
    const view = renderNavigation();
    const scroller = editorScroller(view.container);
    const rendered = within(view.container);

    fireEvent.wheel(scroller, { ctrlKey: true, deltaY: 40 });
    fireEvent.wheel(scroller, { deltaX: 80, deltaY: 20 });
    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");
    expect(rendered.getByLabelText("Kapiteltitel")).toHaveValue("Prolog");
  });

  it.each([
    ["line", 1],
    ["page", 2],
  ])("normalizes %s wheel deltas before applying the input threshold", (_label, deltaMode) => {
    const view = renderNavigation();
    const scroller = editorScroller(view.container);

    fireEvent.wheel(scroller, { deltaMode, deltaY: 1 });

    expect(scroller).toHaveAttribute("data-chapter-turn", "bottom");
  });

  it("ignores sub-threshold pixel wheel noise", () => {
    const view = renderNavigation();
    const scroller = editorScroller(view.container);

    fireEvent.wheel(scroller, { deltaMode: 0, deltaY: 1 });

    expect(scroller).toHaveAttribute("data-chapter-turn", "idle");
  });
});
