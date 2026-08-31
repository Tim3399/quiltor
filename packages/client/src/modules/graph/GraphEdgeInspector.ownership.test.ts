import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "packages/client/src/modules");

function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const resolved = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(resolved) : [resolved];
  });
}

describe("graph edge inspector ownership", () => {
  it("keeps one visible implementation and one stylesheet owner", () => {
    const storyboardAdapter = readFileSync(
      join(sourceRoot, "storyboard/StoryboardEdgeInspector.tsx"),
      "utf8",
    );
    const figureWorkspace = readFileSync(
      join(sourceRoot, "story-world/figures/FigureWorkspace.tsx"),
      "utf8",
    );
    const edgeInspectorStyles = filesBelow(sourceRoot).filter(
      (file) =>
        file.endsWith(".css") &&
        /\.graph-edge-inspector(?:\b|__|-)/.test(readFileSync(file, "utf8")),
    );

    expect(storyboardAdapter).toContain("<GraphEdgeInspector");
    expect(storyboardAdapter).not.toMatch(/<(?:TextField|Checkbox|Button)\b/);
    expect(figureWorkspace).toContain("<GraphEdgeInspector");
    expect(edgeInspectorStyles).toEqual([join(sourceRoot, "graph/GraphEdgeInspector.css")]);
  });
});
