import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "packages/client/src/modules/story-world");
const layoutCss = readFileSync(join(root, "StoryGraph.css"), "utf8");

/**
 * `.figure-layout` is shared by the world graph and the places map. Only the world graph
 * carries the overview column, so the shared rule has to stay at two columns -- giving the
 * base rule three put the places inspector in the middle of the surface with an empty
 * column beside it.
 */
describe("story-world layout columns", () => {
  it("keeps the shared layout at two columns", () => {
    const shared = layoutCss.match(/\.figure-layout\s*\{([^}]*)\}/s)?.[1];

    expect(shared).toBeDefined();
    expect(shared).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) \d+px;/);
  });

  it("adds the overview column only where the overview is rendered", () => {
    const figures = layoutCss.match(/\.figure-workspace \.figure-layout\s*\{([^}]*)\}/s)?.[1];

    expect(figures).toBeDefined();
    expect(figures).toMatch(/grid-template-columns:\s*\d+px minmax\(0, 1fr\) \d+px;/);
  });

  it("narrows both together instead of letting one breakpoint drift", () => {
    const narrow = layoutCss.match(/@media \(max-width: 1050px\)\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(narrow).toMatch(/\.figure-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(narrow).toMatch(
      /\.figure-workspace \.figure-layout\s*\{[^}]*grid-template-columns:\s*\d+px minmax\(0, 1fr\)/s,
    );
  });
});
