import { describe, expect, it } from "vitest";
import {
  BOOK_LAYOUT_PRESETS,
  bookLayoutMatchesPreset,
  DEFAULT_BOOK_LAYOUT,
  resolveBookLayout,
} from "./bookLayout";

describe("book layout settings", () => {
  it("reproduces the current 6x9 novel print defaults", () => {
    expect(DEFAULT_BOOK_LAYOUT).toMatchObject({
      version: 1,
      preset: "quiltor-novel",
      pageFormat: "6x9",
      pageWidthMm: 152.4,
      pageHeightMm: 228.6,
      marginInnerMm: 19.812,
      marginOuterMm: 17.272,
      marginTopMm: 18.288,
      marginBottomMm: 20.828,
      fontSizePt: 10.75,
      lineHeight: 1.54,
      firstLineIndentEm: 1.22,
      chapterStart: "right-page",
      chapterTopMm: 22.352,
      chapterNumberStyle: "padded",
      chapterTitleSizePt: 18,
      dropCap: true,
      sceneSymbol: "⁂",
    });
  });

  it("returns independent defaults and overlays a supplied complete value", () => {
    const defaults = resolveBookLayout();
    expect(defaults).toEqual(DEFAULT_BOOK_LAYOUT);
    expect(defaults).not.toBe(DEFAULT_BOOK_LAYOUT);

    const customized = { ...DEFAULT_BOOK_LAYOUT, author: "Ada", fontSizePt: 12 };
    expect(resolveBookLayout(customized)).toEqual(customized);
    expect(resolveBookLayout(customized)).not.toBe(customized);
  });

  it("recognizes presets while ignoring title-page metadata", () => {
    const novelWithMetadata = {
      ...BOOK_LAYOUT_PRESETS["quiltor-novel"],
      bookTitle: "Nordlicht",
      author: "Ada",
      showDate: false,
    };
    expect(bookLayoutMatchesPreset(novelWithMetadata, "quiltor-novel")).toBe(true);
    expect(bookLayoutMatchesPreset({ ...novelWithMetadata, fontSizePt: 12 }, "quiltor-novel")).toBe(
      false,
    );
    expect(bookLayoutMatchesPreset(BOOK_LAYOUT_PRESETS["a5-manuscript"], "a5-manuscript")).toBe(
      true,
    );
  });
});
