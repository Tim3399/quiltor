import { BOOK_FONT_FAMILIES } from "./bookFonts";
import type { BookLayoutSettings } from "./bookLayout";
import bookCss from "./PrintDocument.css?inline";

export interface BookPage {
  number: number;
  chapterId?: string;
  chapterStart: boolean;
  blank: boolean;
}

export function bookPageMargins(settings: BookLayoutSettings, page: number) {
  const inner = settings.marginInnerMm + settings.gutterMm;
  const leftPage = settings.mirrorMargins && page % 2 === 0;
  return {
    left: leftPage ? settings.marginOuterMm : inner,
    right: leftPage ? inner : settings.marginOuterMm,
  };
}

/** @page dimensions are literals because paged-media parsers cannot resolve custom properties. */
export function bookStyles(settings: BookLayoutSettings) {
  const s = settings;
  const right = bookPageMargins(s, 1);
  const left = bookPageMargins(s, 2);
  return `${bookCss}
    @page { size: ${s.pageWidthMm}mm ${s.pageHeightMm}mm; margin: ${s.marginTopMm}mm ${right.right}mm ${s.marginBottomMm}mm ${right.left}mm; }
    @page :left { margin-left: ${left.left}mm; margin-right: ${left.right}mm; }
    @page :right { margin-left: ${right.left}mm; margin-right: ${right.right}mm; }
    .book-content { font-family: "${BOOK_FONT_FAMILIES[s.fontFamily]}", serif; font-size: ${s.fontSizePt}pt; line-height: ${s.lineHeight}; }
    .book-title-page { height: ${s.pageHeightMm - s.marginTopMm - s.marginBottomMm - 0.1}mm; }
    .book-chapter { break-before: ${s.chapterStart === "right-page" ? "right" : "page"}; }
    .book-chapter__heading { padding-top: ${s.chapterTopMm}mm; text-align: ${s.chapterAlignment}; }
    .book-chapter h2 { font-size: ${s.chapterTitleSizePt}pt; }
    .book-paragraph { text-align: ${s.alignment}; text-indent: ${s.firstLineIndent ? s.firstLineIndentEm : 0}em; margin-bottom: ${s.paragraphSpacingEm}em; hyphens: ${s.hyphenation ? "auto" : "none"}; widows: ${s.widows}; orphans: ${s.orphans}; }
    .book-paragraph--first { text-indent: ${s.chapterFirstIndent ? s.firstLineIndentEm : 0}em; }
    .book-paragraph[data-split-from] { text-indent: 0; }
    ${s.dropCap ? `.book-paragraph--first:not([data-split-from])::first-letter { float: left; margin: 0.06em 0.08em 0 0; font-size: 3.15em; line-height: 0.78; font-weight: 700; }` : ""}
    .book-scene-break { padding-top: ${s.sceneSpaceBeforeMm}mm; padding-bottom: ${s.sceneSpaceAfterMm}mm; }
  `;
}

export function bookPageNumber(
  page: BookPage,
  firstChapterPage: number,
  settings: BookLayoutSettings,
): string | undefined {
  if (
    !settings.pageNumbers ||
    page.blank ||
    (page.number === 1 && settings.hideTitlePageNumber) ||
    (page.chapterStart && settings.hideChapterPageNumbers) ||
    (settings.numberFromFirstChapter && page.number < firstChapterPage)
  )
    return undefined;
  return String(settings.numberFromFirstChapter ? page.number - firstChapterPage + 1 : page.number);
}

/** Explicit numbers avoid differences in native WebKit @page margin-box support. */
export function annotateBookPages(root: HTMLElement, settings: BookLayoutSettings): BookPage[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(".pagedjs_page"));
  const pages = elements.map((element, index) => {
    const chapter = element.querySelector<HTMLElement>(".book-chapter");
    const page: BookPage = {
      number: index + 1,
      chapterId: chapter?.dataset.chapterId,
      chapterStart: Boolean(element.querySelector(".book-chapter__heading:not([data-split-from])")),
      blank: element.classList.contains("pagedjs_blank_page"),
    };
    element.dataset.pageNumber = String(page.number);
    if (page.chapterId) element.dataset.chapterId = page.chapterId;
    element.dataset.chapterStart = String(page.chapterStart);
    element.dataset.blank = String(page.blank);
    return page;
  });
  const firstChapterPage =
    pages.find((page) => page.chapterStart)?.number ?? Number.POSITIVE_INFINITY;
  elements.forEach((element, index) => {
    const page = pages[index];
    const label = bookPageNumber(page, firstChapterPage, settings);
    if (label === undefined) return;
    const number = document.createElement("span");
    number.className = "book-page-number";
    number.textContent = label;
    number.dataset.printedNumber = label;
    const margins = bookPageMargins(settings, page.number);
    number.style.left = `${margins.left}mm`;
    number.style.right = `${margins.right}mm`;
    number.style.fontFamily = `"${BOOK_FONT_FAMILIES[settings.fontFamily]}", serif`;
    const top = settings.pageNumberPosition === "top-outside";
    number.style[top ? "top" : "bottom"] =
      `${(top ? settings.marginTopMm : settings.marginBottomMm) / 2}mm`;
    number.style.textAlign =
      settings.pageNumberPosition === "bottom-center"
        ? "center"
        : page.number % 2 === 0
          ? "left"
          : "right";
    element.querySelector(".pagedjs_pagebox")?.append(number);
  });
  return pages;
}
