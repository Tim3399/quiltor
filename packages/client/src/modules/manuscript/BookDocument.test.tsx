import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOOK_LAYOUT } from "./bookLayout";
import type { Manuscript } from "./model";

const paged = vi.hoisted(() => ({
  preview: vi.fn(),
  chunkerDestroy: vi.fn(),
  polisherDestroy: vi.fn(),
}));

const fonts = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("pagedjs", () => ({
  Previewer: class {
    chunker = { destroy: paged.chunkerDestroy };
    polisher = { destroy: paged.polisherDestroy };
    preview = paged.preview;
  },
}));

vi.mock("./bookFonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bookFonts")>()),
  loadBookFont: fonts.load,
}));

import { BookDocument } from "./BookDocument";

const manuscript: Manuscript = {
  chapters: [
    {
      id: "chapter-1",
      title: "Die Ankunft",
      body: "Der Morgen lag still über dem Hafen.",
      note: "",
    },
  ],
  bookLayout: { ...DEFAULT_BOOK_LAYOUT },
};

function appendPage(target: HTMLElement) {
  const pages = document.createElement("div");
  pages.className = "pagedjs_pages";
  const page = document.createElement("div");
  page.className = "pagedjs_page";
  const pageBox = document.createElement("div");
  pageBox.className = "pagedjs_pagebox";
  page.append(pageBox);
  pages.append(page);
  target.append(pages);
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function passDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fonts.load.mockResolvedValue(undefined);
  paged.preview.mockImplementation(async (_source, _styles, target: HTMLElement) => {
    appendPage(target);
  });
});

afterEach(async () => {
  cleanup();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BookDocument pagination lifecycle", () => {
  it("does not repaginate when a zoom-only parent rerender leaves the book unchanged", async () => {
    function Parent({ zoom }: { zoom: number }) {
      return (
        <div data-zoom={zoom}>
          <BookDocument manuscript={manuscript} />
        </div>
      );
    }

    const view = render(<Parent zoom={1} />);
    await passDebounce();
    expect(paged.preview).toHaveBeenCalledOnce();
    expect(view.container.querySelector(".print-document")).toHaveAttribute(
      "data-book-ready",
      "true",
    );

    view.rerender(<Parent zoom={1.4} />);
    await flushPromises();

    expect(paged.preview).toHaveBeenCalledOnce();
  });

  it("debounces rapid layout changes and paginates only the latest settings", async () => {
    const view = render(<BookDocument manuscript={manuscript} />);
    view.rerender(
      <BookDocument
        manuscript={{
          ...manuscript,
          bookLayout: { ...DEFAULT_BOOK_LAYOUT, fontFamily: "literata", pageWidthMm: 148 },
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    view.rerender(
      <BookDocument
        manuscript={{
          ...manuscript,
          bookLayout: {
            ...DEFAULT_BOOK_LAYOUT,
            fontFamily: "source-serif-4",
            pageWidthMm: 170,
          },
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(paged.preview).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(paged.preview).toHaveBeenCalledOnce();
    expect(fonts.load).toHaveBeenCalledOnce();
    expect(fonts.load).toHaveBeenCalledWith("source-serif-4");
    expect(view.container.querySelector(".print-document")).toHaveAttribute(
      "data-book-width-mm",
      "170",
    );
  });

  it("does not publish stale asynchronous pagination after unmount", async () => {
    const pending = deferred();
    paged.preview.mockImplementation(async (_source, _styles, target: HTMLElement) => {
      appendPage(target);
      await pending.promise;
    });
    const onReady = vi.fn();
    const onError = vi.fn();
    const view = render(
      <BookDocument manuscript={manuscript} onReady={onReady} onError={onError} />,
    );
    await passDebounce();
    expect(document.querySelector(".book-pagination-stage")).not.toBeNull();

    view.unmount();
    pending.resolve();
    await flushPromises();

    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(document.querySelector(".book-pagination-stage")).toBeNull();
  });

  it("waits for the selected font before starting pagination", async () => {
    const font = deferred();
    fonts.load.mockReturnValue(font.promise);
    render(<BookDocument manuscript={manuscript} />);

    await passDebounce();
    expect(fonts.load).toHaveBeenCalledWith(DEFAULT_BOOK_LAYOUT.fontFamily);
    expect(paged.preview).not.toHaveBeenCalled();

    font.resolve();
    await flushPromises();

    expect(paged.preview).toHaveBeenCalledOnce();
  });

  it.each([
    ["a pagination failure", () => Promise.reject(new Error("pagination failed"))],
    ["an empty pagination result", () => Promise.resolve()],
  ])("publishes the error readiness contract for %s", async (_case, implementation) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    paged.preview.mockImplementation(async (_source, _styles, target: HTMLElement) => {
      if (_case === "an empty pagination result") return implementation();
      appendPage(target);
      return implementation();
    });
    const onReady = vi.fn();
    const onError = vi.fn();
    const view = render(
      <BookDocument manuscript={manuscript} onReady={onReady} onError={onError} />,
    );

    await passDebounce();
    await flushPromises();

    const root = view.container.querySelector(".print-document");
    expect(root).toHaveAttribute("data-book-ready", "false");
    expect(root).toHaveAttribute("data-book-error", "true");
    expect(root).toHaveAttribute("aria-busy", "false");
    expect(root?.querySelector(".pagedjs_page")).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});
