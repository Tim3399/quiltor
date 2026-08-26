import { describe, expect, it } from "vitest";
import publicIndex from "../../index.ts?raw";
import { designStories } from "./registry";

describe("design gallery registry", () => {
  it("covers every exported public component folder", () => {
    const publicComponents = [
      ...publicIndex.matchAll(
        /export \* from "\.\/(?:components|patterns|primitives)\/([^"/]+)";/g,
      ),
    ]
      .map((match) => match[1])
      .sort();
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

  it("publishes every reviewed scenario as stable", () => {
    expect(new Set(designStories.map((story) => story.status))).toEqual(new Set(["stable"]));
  });
});
