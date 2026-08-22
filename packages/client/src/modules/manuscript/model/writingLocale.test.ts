import { describe, expect, it } from "vitest";
import { defaultWritingLocale, writingLocales } from "./writingLocale";

describe("writing locale registry", () => {
  it("keeps the manuscript locale independent from the interface locale", () => {
    expect(defaultWritingLocale).toBe("de-DE");
    expect(writingLocales["de-DE"]).toMatchObject({
      dictionaryAvailable: true,
      thesaurusAvailable: true,
      translationTargets: ["en"],
    });
  });
});
