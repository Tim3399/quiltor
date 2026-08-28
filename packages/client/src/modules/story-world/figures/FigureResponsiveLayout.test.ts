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
    const timeline = stylesheet("TimelineStrip.css");
    const inspector = stylesheet("FigureInspector.css");

    expect(canvas).toMatch(
      /\.flow-area\.has-timeline \.react-flow__minimap\s*\{[^}]*top:\s*14px;[^}]*bottom:\s*auto;/s,
    );
    expect(canvas).toMatch(
      /@media \(min-width: 821px\) and \(max-width: 1050px\)[\s\S]*?\.flow-area\.has-timeline \.react-flow__minimap\s*\{[^}]*display:\s*none;/,
    );
    expect(canvas).not.toMatch(
      /@media \(min-width: 821px\) and \(max-width: 1050px\)[\s\S]*?\.react-flow__minimap\s*\{[^}]*(?:width|height):/,
    );
    expect(timeline).toMatch(
      /\.flow-area \.timeline-strip\s*\{[^}]*right:\s*14px;[^}]*left:\s*62px;/s,
    );
    expect(timeline).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.timeline-strip\s*\{[^}]*max-height:\s*min\(52%, 360px\);[^}]*overflow-y:\s*auto;/,
    );
    expect(inspector).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.figure-inspector\s*\{[^}]*top:\s*auto;[^}]*left:\s*0;[^}]*width:\s*100%;[^}]*height:\s*min\(58%, 440px\);/,
    );
  });
});
