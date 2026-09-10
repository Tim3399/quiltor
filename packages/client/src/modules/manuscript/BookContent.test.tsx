import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookContent, chapterNumber, isSceneBreak } from "./BookContent";
import { DEFAULT_BOOK_LAYOUT } from "./bookLayout";
import { annotateBookPages, bookPageMargins, bookPageNumber, bookStyles } from "./bookPagination";

describe("Shared book typesetting", () => {
  it("preserves semantic marks, first paragraph and scene separators without interpreting markup", () => {
    const { container } = render(
      <BookContent
        date="10.9.2026"
        worldTitle="Nebel"
        settings={{
          ...DEFAULT_BOOK_LAYOUT,
          sceneSymbol: "◆",
          author: "Anna",
          subtitle: "Am Hafen",
        }}
        manuscript={{
          chapters: [
            {
              id: "c1",
              title: "Morgen",
              note: "",
              body: "Still und leise.\n\n* * *\n\n<script>Text</script>",
              marks: [
                { from: 0, to: 5, kind: "bold" },
                { from: 0, to: 5, kind: "italic" },
              ],
            },
          ],
        }}
      />,
    );
    expect(container.querySelector("em strong")).toHaveTextContent("Still");
    expect(container.querySelectorAll(".book-paragraph--first")).toHaveLength(1);
    expect(container.querySelector(".book-scene-break")).toHaveTextContent("◆");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>Text</script>")).toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
  });

  it("supports hidden chapter headings and all numbering styles", () => {
    const { container } = render(
      <BookContent
        date=""
        settings={{ ...DEFAULT_BOOK_LAYOUT, chapterNumber: false, chapterTitle: false }}
        manuscript={{ chapters: [{ id: "c1", title: "Morgen", body: "Text", note: "" }] }}
      />,
    );
    expect(container.querySelector(".book-chapter h2")).toBeNull();
    expect(container.querySelector(".book-chapter__number")).toBeNull();
    expect(chapterNumber(2, "number")).toBe("3");
    expect(chapterNumber(2, "padded")).toBe("03");
    expect(chapterNumber(2, "chapter")).toBe("Kapitel 3");
    expect(["⁂", "◆", "*", "* * *"].every(isSceneBreak)).toBe(true);
    expect(isSceneBreak("Im *Wald*")).toBe(false);
  });

  it("uses physical mirror margins, including the binding gutter, without zoom input", () => {
    const settings = { ...DEFAULT_BOOK_LAYOUT, gutterMm: 3 };
    expect(bookPageMargins(settings, 1)).toEqual({ left: 22.812, right: 17.272 });
    expect(bookPageMargins(settings, 2)).toEqual({ left: 17.272, right: 22.812 });
    expect(bookPageMargins({ ...settings, mirrorMargins: false }, 2)).toEqual(
      bookPageMargins(settings, 1),
    );
    expect(bookStyles(settings)).toContain("size: 152.4mm 228.6mm");
    expect(bookStyles({ ...settings, dropCap: false })).not.toContain("::first-letter");
  });

  it("numbers physical pages while respecting title, chapter and frontmatter settings", () => {
    const page = { number: 3, chapterId: "c1", chapterStart: true, blank: false };
    expect(bookPageNumber(page, 3, DEFAULT_BOOK_LAYOUT)).toBe("3");
    expect(bookPageNumber(page, 3, { ...DEFAULT_BOOK_LAYOUT, numberFromFirstChapter: true })).toBe(
      "1",
    );
    expect(
      bookPageNumber(page, 3, { ...DEFAULT_BOOK_LAYOUT, hideChapterPageNumbers: true }),
    ).toBeUndefined();
    expect(bookPageNumber({ ...page, blank: true }, 3, DEFAULT_BOOK_LAYOUT)).toBeUndefined();
    expect(
      bookPageNumber({ ...page, number: 1, chapterStart: false }, 3, DEFAULT_BOOK_LAYOUT),
    ).toBeUndefined();
  });

  it("annotates chapter destinations and places numbers in the same final page DOM", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="pagedjs_page"><div class="pagedjs_pagebox"><section class="book-title-page"></section></div></div><div class="pagedjs_page pagedjs_blank_page"><div class="pagedjs_pagebox"></div></div><div class="pagedjs_page"><div class="pagedjs_pagebox"><section class="book-chapter" data-chapter-id="c1"><header class="book-chapter__heading"></header></section></div></div>';
    const pages = annotateBookPages(root, { ...DEFAULT_BOOK_LAYOUT, numberFromFirstChapter: true });
    expect(pages[2]).toEqual({ number: 3, chapterId: "c1", chapterStart: true, blank: false });
    expect(root.querySelectorAll(".book-page-number")).toHaveLength(1);
    expect(root.querySelector(".book-page-number")).toHaveTextContent("1");
    expect(root.querySelector('[data-page-number="3"]')).toHaveAttribute(
      "data-chapter-start",
      "true",
    );
  });
});
