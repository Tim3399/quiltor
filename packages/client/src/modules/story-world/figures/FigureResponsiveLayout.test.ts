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
    // Docked above the canvas (T-328): its row is capped by the stage, not by the strip, so
    // no empty band is left under a strip that shrank inside a taller auto row.
    expect(canvas).toMatch(
      /\.figure-stage\s*\{[^}]*grid-template-rows:\s*fit-content\(40%\) minmax\(0, 1fr\);/,
    );
    expect(canvas).not.toMatch(/\.timeline-strip/);
    expect(viewportChrome).toMatch(
      /\.graph-viewport-surface\.has-minimap\s*\{[^}]*--graph-edge-inspector-safe-bottom:\s*calc\([\s\S]*var\(--graph-minimap-block-size\)/,
    );
    expect(viewportChrome).toMatch(
      /@media \(max-width: 820px\)[\s\S]*--graph-minimap-inline-size:\s*140px;[\s\S]*--graph-minimap-block-size:\s*105px;[\s\S]*--graph-minimap-scale:\s*0\.7;/,
    );
    expect(stylesheet("../StoryGraph.css")).not.toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.react-flow__minimap\s*\{[^}]*display:\s*none;/,
    );
    // The strip shares no area with dock, minimap or lock button any more: it neither
    // floats nor carries rules for getting out of their way, and scrolls inside its row.
    expect(timeline).not.toMatch(/\.flow-area[^{]*\.timeline-strip/);
    expect(timeline).not.toMatch(/\.timeline-strip\s*\{[^}]*position:\s*absolute/);
    expect(timeline).not.toMatch(/\.timeline-strip\s*\{[^}]*max-height/);
    expect(timeline).toMatch(/\.timeline-strip\s*\{[^}]*overflow-y:\s*auto;/);
    expect(inspector).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.figure-inspector\s*\{[^}]*top:\s*auto;[^}]*left:\s*0;[^}]*width:\s*100%;[^}]*height:\s*min\(58%, 440px\);/,
    );
  });
});
