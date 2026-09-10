import type { BookLayoutSettings } from "../../../modules/manuscript";
import {
  WireContractError,
  wireBoolean,
  wireEnum,
  wireInteger,
  wireNumber,
  wireRecord,
  wireString,
} from "./validation";

export type BookLayoutWireV1 = BookLayoutSettings & Record<string, unknown>;

export function validateBookLayoutV1(value: unknown, path: string): BookLayoutWireV1 {
  const layout = wireRecord(value, path);
  const number = (key: string, min: number, max: number) =>
    wireNumber(layout[key], `${path}.${key}`, { min, max });
  const bool = (key: string) => wireBoolean(layout[key], `${path}.${key}`);
  const text = (key: string) => wireString(layout[key], `${path}.${key}`, { max: 1000 });

  wireInteger(layout.version, `${path}.version`, { min: 1, max: 1 });
  wireEnum(
    layout.preset,
    ["quiltor-novel", "classic-paperback", "a5-manuscript"] as const,
    `${path}.preset`,
  );
  wireEnum(layout.pageFormat, ["6x9", "a5", "5.5x8.5", "custom"] as const, `${path}.pageFormat`);
  const pageWidth = number("pageWidthMm", 80, 500);
  const pageHeight = number("pageHeightMm", 80, 500);
  const inner = number("marginInnerMm", 0, 100);
  const outer = number("marginOuterMm", 0, 100);
  const top = number("marginTopMm", 0, 100);
  const bottom = number("marginBottomMm", 0, 100);
  const gutter = number("gutterMm", 0, 50);
  bool("mirrorMargins");
  wireEnum(
    layout.fontFamily,
    ["eb-garamond", "literata", "source-serif-4", "crimson-pro", "libre-baskerville"] as const,
    `${path}.fontFamily`,
  );
  number("fontSizePt", 6, 36);
  number("lineHeight", 0.8, 3);
  wireEnum(layout.alignment, ["justify", "left"] as const, `${path}.alignment`);
  bool("hyphenation");
  bool("firstLineIndent");
  number("firstLineIndentEm", 0, 10);
  number("paragraphSpacingEm", 0, 10);
  wireInteger(layout.widows, `${path}.widows`, { min: 1, max: 5 });
  wireInteger(layout.orphans, `${path}.orphans`, { min: 1, max: 5 });
  wireEnum(layout.chapterStart, ["next-page", "right-page"] as const, `${path}.chapterStart`);
  number("chapterTopMm", 0, 150);
  bool("chapterNumber");
  wireEnum(
    layout.chapterNumberStyle,
    ["number", "padded", "chapter"] as const,
    `${path}.chapterNumberStyle`,
  );
  bool("chapterTitle");
  wireEnum(layout.chapterAlignment, ["left", "center"] as const, `${path}.chapterAlignment`);
  number("chapterTitleSizePt", 6, 72);
  bool("dropCap");
  bool("chapterFirstIndent");
  const sceneSymbol = wireString(layout.sceneSymbol, `${path}.sceneSymbol`, { max: 32 });
  if (sceneSymbol.length > 0 && sceneSymbol.trim().length === 0) {
    throw new WireContractError(`${path}.sceneSymbol`);
  }
  number("sceneSpaceBeforeMm", 0, 100);
  number("sceneSpaceAfterMm", 0, 100);
  bool("pageNumbers");
  wireEnum(
    layout.pageNumberPosition,
    ["bottom-center", "bottom-outside", "top-outside"] as const,
    `${path}.pageNumberPosition`,
  );
  bool("hideChapterPageNumbers");
  bool("hideTitlePageNumber");
  bool("numberFromFirstChapter");
  for (const key of ["bookTitle", "subtitle", "author", "series", "volume"]) text(key);
  bool("showNovelLabel");
  bool("showVersion");
  bool("showDate");

  if (pageWidth - inner - outer - gutter < 30) {
    throw new WireContractError(`${path}.pageWidthMm`);
  }
  if (pageHeight - top - bottom < 30) {
    throw new WireContractError(`${path}.pageHeightMm`);
  }
  return { ...layout } as BookLayoutWireV1;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneJsonValue(item),
      ]),
    );
  }
  return value;
}

export function cloneBookLayoutV1(
  value: BookLayoutSettings | BookLayoutWireV1 | undefined,
): BookLayoutWireV1 | undefined {
  return value === undefined ? undefined : (cloneJsonValue(value) as BookLayoutWireV1);
}
