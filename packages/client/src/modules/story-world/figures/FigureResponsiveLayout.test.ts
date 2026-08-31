import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const moduleDirectory = join(process.cwd(), "packages/client/src/modules/story-world/figures");

function stylesheet(name: string) {
  return readFileSync(join(moduleDirectory, name), "utf8");
}

describe("figure workspace responsive layout contracts", () => {
  it("keeps overview nodes recognizable at narrow viewport sizes", () => {
    const css = stylesheet("../StoryGraph.css");

    expect(css).toMatch(
      /\.story-node\.zoom-overview:not\(\.is-important\)\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s,
    );
    expect(css).toMatch(/\.story-node\.zoom-overview \.node-monogram\s*\{[^}]*display:\s*grid;/s);
    expect(css).toMatch(
      /@media \(max-width: 640px\), \(pointer: coarse\)[\s\S]*?\.story-node\.zoom-overview:not\(\.is-important\)\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/,
    );
  });

  it("separates the timeline, minimap, and mobile inspector surfaces", () => {
    const canvas = stylesheet("FigureCanvas.css");
    const viewportChrome = stylesheet("../../graph/GraphViewportChrome.css");
    const timeline = stylesheet("TimelineStrip.css");
    const inspector = stylesheet("FigureInspector.css");

    expect(viewportChrome).toMatch(
      /\.graph-viewport-surface \.react-flow__panel\.react-flow__minimap\s*\{[^}]*top:\s*auto;[^}]*right:\s*var\(--graph-viewport-inset\);[^}]*bottom:\s*var\(--graph-viewport-inset\);[^}]*left:\s*auto;[^}]*margin:\s*0;/s,
    );
    expect(canvas).not.toMatch(/\.has-timeline \.react-flow__minimap\s*\{/);
    expect(canvas).toMatch(
      /\.flow-area\.has-timeline\.has-minimap \.timeline-strip\s*\{[^}]*right:\s*calc\([\s\S]*var\(--graph-minimap-inline-size\)/,
    );
    expect(viewportChrome).toMatch(
      /\.graph-viewport-surface\.has-minimap\s*\{[^}]*--graph-edge-inspector-safe-bottom:\s*calc\([\s\S]*var\(--graph-minimap-block-size\)/,
    );
    expect(viewportChrome).toMatch(
      /@media \(max-width: 820px\)[\s\S]*--graph-minimap-inline-size:\s*140px;[\s\S]*--graph-minimap-block-size:\s*105px;[\s\S]*--graph-minimap-scale:\s*0\.7;/,
    );
    expect(stylesheet("../StoryGraph.css")).not.toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.react-flow__minimap\s*\{[^}]*display:\s*none;/,
    );
    expect(timeline).toMatch(
      /\.flow-area \.timeline-strip\s*\{[^}]*right:\s*var\(--graph-viewport-inset,[^}]*left:\s*var\(--graph-controls-safe-inline-end,/s,
    );
    expect(timeline).not.toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.flow-area \.timeline-strip\s*\{[^}]*left:\s*var\(--space-8\);/,
    );
    expect(timeline).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.timeline-strip\s*\{[^}]*max-height:\s*min\(52%, 360px\);[^}]*overflow-y:\s*auto;/,
    );
    expect(inspector).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.figure-inspector\s*\{[^}]*top:\s*auto;[^}]*left:\s*0;[^}]*width:\s*100%;[^}]*height:\s*min\(58%, 440px\);/,
    );
  });
});
