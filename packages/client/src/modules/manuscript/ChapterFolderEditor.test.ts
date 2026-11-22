import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does no layout, so the width of the rename input cannot be measured here. What can be
// checked is the cause of T-351: `.binder-folder-editor` is a `.ui-field` (a grid) whose only
// in-flow child is the input -- the label is `.sr-only` and absolutely positioned. A second
// track therefore pushes the input into the first one, which was 16px wide.
describe("binder folder rename field", () => {
  const css = readFileSync(
    join(process.cwd(), "packages/client/src/modules/manuscript/ChapterFolderTree.css"),
    "utf8",
  );
  const rule = /(?:^|\})\s*\.binder-folder-editor\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";

  it("declares the editor rule", () => {
    expect(rule).toContain("display: grid");
  });

  it("gives the input a single full-width track, not a track reserved for the hidden label", () => {
    const columns = /grid-template-columns:\s*([^;]+);/.exec(rule)?.[1]?.trim();
    expect(columns === undefined || columns === "minmax(0, 1fr)").toBe(true);
  });
});
