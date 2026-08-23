import { describe, expect, it } from "vitest";
import * as publicDesign from "../../index";
import { designStories } from "./registry";

describe("design gallery registry", () => {
  it("covers every runtime component in the public design API", () => {
    const publicComponents = Object.keys(publicDesign).sort();
    const coveredComponents = [
      ...new Set(designStories.map((story) => story.id.split("/")[0])),
    ].sort();

    expect(coveredComponents).toEqual(publicComponents);
  });

  it("keeps story ids unique and every component scenario non-empty", () => {
    const ids = designStories.map((story) => story.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[^/]+\/[^/]+$/.test(id))).toBe(true);
  });
});
