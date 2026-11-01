import { describe, expect, it } from "vitest";
import { defaultLocaleCatalog } from "../../../../locales";

describe("German interface strings", () => {
  it("spell the map scale as Maßstab everywhere", () => {
    const wrong = Object.entries(defaultLocaleCatalog).filter(([, text]) =>
      /ma(ss|s)stab/i.test(String(text)),
    );
    expect(wrong.map(([key]) => key)).toEqual([]);
  });
});
