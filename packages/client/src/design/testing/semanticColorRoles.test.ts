import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), "packages/client/src", path), "utf8");
}

describe("semantic color roles", () => {
  it("uses the readable gold role for compact text and icons", () => {
    const history = source("modules/history/HistoryDialog.css");
    expect(history).toMatch(/\.diff-kind\s*\{[^}]*color:\s*var\(--gold-text\);/s);
    expect(history).toMatch(/\.diff-segment h3\s*\{[^}]*color:\s*var\(--gold-text\);/s);

    const figures = source("modules/story-world/figures/FigureInspector.css");
    expect(figures).toMatch(/\.relation-list span\s*\{[^}]*color:\s*var\(--gold-text\);/s);
    expect(figures).toMatch(
      /\.relation-direction,\s*\.relation-undirected\s*\{[^}]*color:\s*var\(--gold-text\);/s,
    );
  });

  it("keeps warning feedback independent from the decorative gold palette", () => {
    const alert = source("design/components/Alert/Alert.css");
    expect(alert).toMatch(
      /\.design-alert--warning\s*\{[^}]*border-color:\s*var\(--warning-border\);[^}]*background:\s*var\(--warning-bg\);[^}]*color:\s*var\(--warning-text\);/s,
    );
    expect(alert.match(/\.design-alert--warning\s*\{([^}]*)\}/s)?.[1]).not.toContain("--gold");

    const toast = source("design/components/Toast/Toast.css");
    expect(toast).toMatch(
      /\.design-toast--warning\s*\{[^}]*border-color:\s*var\(--warning-border\);/s,
    );
    expect(toast.match(/\.design-toast--warning\s*\{([^}]*)\}/s)?.[1]).not.toContain("--gold");
  });

  it("separates rose and moss fills, text and structural accents", () => {
    const graph = source("modules/story-world/StoryGraph.css");
    expect(graph).toMatch(
      /\.story-node\.accent-rose\s*\{[^}]*border-left-color:\s*var\(--rose-border\);/s,
    );
    expect(graph).toMatch(
      /\.story-node\.accent-moss\s*\{[^}]*border-left-color:\s*var\(--moss-border\);/s,
    );
    expect(graph).toMatch(/\.story-node strong svg\s*\{[^}]*color:\s*var\(--rose-text\);/s);

    const inspector = source("modules/story-world/figures/FigureInspector.css");
    expect(inspector).toMatch(
      /\.timeline-life-action\.active\s*\{[^}]*border-color:\s*var\(--rose-border\);[^}]*background:\s*var\(--rose-soft\);[^}]*color:\s*var\(--rose-text\);/s,
    );

    const canvas = source("modules/story-world/figures/FigureCanvas.css");
    expect(canvas).toMatch(
      /\.react-flow__edge\.edge-blood \.react-flow__edge-path\s*\{[^}]*stroke:\s*var\(--rose-border\);/s,
    );
    expect(canvas).toMatch(/\.story-node \.neutral-handle\s*\{[^}]*background:\s*var\(--moss\);/s);
  });
});
