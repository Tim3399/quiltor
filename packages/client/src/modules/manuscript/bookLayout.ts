export type BookLayoutPresetId = "quiltor-novel" | "classic-paperback" | "a5-manuscript";

export interface BookLayoutSettings {
  version: 1;
  preset: BookLayoutPresetId;
  pageFormat: "6x9" | "a5" | "5.5x8.5" | "custom";
  pageWidthMm: number;
  pageHeightMm: number;
  marginInnerMm: number;
  marginOuterMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  gutterMm: number;
  mirrorMargins: boolean;
  fontFamily: "eb-garamond" | "literata" | "source-serif-4" | "crimson-pro" | "libre-baskerville";
  fontSizePt: number;
  lineHeight: number;
  alignment: "justify" | "left";
  hyphenation: boolean;
  firstLineIndent: boolean;
  firstLineIndentEm: number;
  paragraphSpacingEm: number;
  widows: number;
  orphans: number;
  chapterStart: "next-page" | "right-page";
  chapterTopMm: number;
  chapterNumber: boolean;
  chapterNumberStyle: "number" | "padded" | "chapter";
  chapterTitle: boolean;
  chapterAlignment: "left" | "center";
  chapterTitleSizePt: number;
  dropCap: boolean;
  chapterFirstIndent: boolean;
  sceneSymbol: string;
  sceneSpaceBeforeMm: number;
  sceneSpaceAfterMm: number;
  pageNumbers: boolean;
  pageNumberPosition: "bottom-center" | "bottom-outside" | "top-outside";
  hideChapterPageNumbers: boolean;
  hideTitlePageNumber: boolean;
  numberFromFirstChapter: boolean;
  bookTitle: string;
  subtitle: string;
  author: string;
  series: string;
  volume: string;
  showNovelLabel: boolean;
  showVersion: boolean;
  showDate: boolean;
  [key: string]: unknown;
}

export const DEFAULT_BOOK_LAYOUT: BookLayoutSettings = {
  version: 1,
  preset: "quiltor-novel",
  pageFormat: "6x9",
  pageWidthMm: 152.4,
  pageHeightMm: 228.6,
  marginInnerMm: 19.812,
  marginOuterMm: 17.272,
  marginTopMm: 18.288,
  marginBottomMm: 20.828,
  gutterMm: 0,
  mirrorMargins: true,
  fontFamily: "eb-garamond",
  fontSizePt: 10.75,
  lineHeight: 1.54,
  alignment: "justify",
  hyphenation: true,
  firstLineIndent: true,
  firstLineIndentEm: 1.22,
  paragraphSpacingEm: 0,
  widows: 3,
  orphans: 3,
  chapterStart: "right-page",
  chapterTopMm: 22.352,
  chapterNumber: true,
  chapterNumberStyle: "padded",
  chapterTitle: true,
  chapterAlignment: "center",
  chapterTitleSizePt: 18,
  dropCap: true,
  chapterFirstIndent: false,
  sceneSymbol: "⁂",
  sceneSpaceBeforeMm: 6.985,
  sceneSpaceAfterMm: 6.985,
  pageNumbers: true,
  pageNumberPosition: "bottom-center",
  hideChapterPageNumbers: false,
  hideTitlePageNumber: true,
  numberFromFirstChapter: false,
  bookTitle: "",
  subtitle: "",
  author: "",
  series: "",
  volume: "",
  showNovelLabel: true,
  showVersion: true,
  showDate: true,
};

export const BOOK_LAYOUT_PRESETS: Readonly<Record<BookLayoutPresetId, BookLayoutSettings>> = {
  "quiltor-novel": DEFAULT_BOOK_LAYOUT,
  "classic-paperback": {
    ...DEFAULT_BOOK_LAYOUT,
    preset: "classic-paperback",
    pageFormat: "5.5x8.5",
    pageWidthMm: 139.7,
    pageHeightMm: 215.9,
    fontFamily: "crimson-pro",
    fontSizePt: 11,
    lineHeight: 1.45,
    chapterNumberStyle: "chapter",
    sceneSymbol: "* * *",
  },
  "a5-manuscript": {
    ...DEFAULT_BOOK_LAYOUT,
    preset: "a5-manuscript",
    pageFormat: "a5",
    pageWidthMm: 148,
    pageHeightMm: 210,
    mirrorMargins: false,
    fontFamily: "source-serif-4",
    fontSizePt: 12,
    lineHeight: 1.5,
    alignment: "left",
    hyphenation: false,
    chapterStart: "next-page",
    dropCap: false,
    pageNumberPosition: "bottom-center",
  },
};

export function resolveBookLayout(value?: BookLayoutSettings): BookLayoutSettings {
  return { ...DEFAULT_BOOK_LAYOUT, ...value };
}

const METADATA_FIELDS = new Set<keyof BookLayoutSettings>([
  "bookTitle",
  "subtitle",
  "author",
  "series",
  "volume",
  "showNovelLabel",
  "showVersion",
  "showDate",
]);

export function bookLayoutMatchesPreset(
  settings: BookLayoutSettings,
  id: BookLayoutPresetId,
): boolean {
  const preset = BOOK_LAYOUT_PRESETS[id];
  return (Object.keys(preset) as Array<keyof BookLayoutSettings>).every(
    (key) => METADATA_FIELDS.has(key) || settings[key] === preset[key],
  );
}
