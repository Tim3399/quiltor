import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "packages/client/src/modules");

function source(path: string) {
  return readFileSync(join(sourceRoot, path), "utf8");
}

describe("graph viewport chrome ownership", () => {
  it("keeps figures, places, and storyboard on the shared control and minimap component", () => {
    const sharedCanvas = source("story-world/StoryGraphCanvas.tsx");
    const storyboard = source("storyboard/StoryboardWorkspace.tsx");

    expect(sharedCanvas).toContain("<GraphViewportChrome");
    expect(storyboard).toContain("<GraphViewportChrome");
    expect(sharedCanvas).toContain("graph-viewport-surface");
    expect(storyboard).toContain("graph-viewport-surface");
    expect(sharedCanvas).not.toMatch(/<(?:Controls|MiniMap)\b/);
    expect(storyboard).not.toMatch(/<(?:Controls|MiniMap)\b/);
  });

  it("owns all React Flow viewport chrome styles in the shared graph module", () => {
    const chrome = source("graph/GraphViewportChrome.css");
    const storyGraph = source("story-world/StoryGraph.css");
    const storyboard = source("storyboard/StoryboardWorkspace.css");

    expect(chrome).toMatch(/\.graph-viewport-surface \.react-flow__panel\.react-flow__controls/);
    expect(chrome).toMatch(/\.graph-viewport-surface \.react-flow__panel\.react-flow__minimap/);
    expect(chrome).toMatch(/\.graph-viewport-surface \.react-flow__attribution/);
    expect(chrome).toMatch(
      /\.graph-viewport-surface[\s\S]*\.graph-minimap-toggle\[aria-pressed="true"\]/,
    );
    expect(chrome).toMatch(
      /\.graph-viewport-surface \.react-flow__controls-button\.graph-minimap-toggle svg\s*\{[^}]*fill:\s*none;/s,
    );
    for (const featureCss of [storyGraph, storyboard]) {
      expect(featureCss).not.toMatch(/\.react-flow__(?:controls|minimap|attribution)/);
      expect(featureCss).not.toContain("--xy-controls-");
      expect(featureCss).not.toContain("--xy-minimap-");
    }
  });
});
