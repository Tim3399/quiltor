import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), "packages/client/src", path), "utf8");
}

describe("semantic color roles", () => {
  it("uses the readable primary-accent role for compact text and icons", () => {
    const history = source("modules/history/HistoryDialog.css");
    expect(history).toMatch(/\.diff-kind\s*\{[^}]*color:\s*var\(--accent-primary-text\);/s);
    expect(history).toMatch(/\.diff-segment h3\s*\{[^}]*color:\s*var\(--accent-primary-text\);/s);

    const figures = source("modules/story-world/figures/FigureInspector.css");
    expect(figures).not.toMatch(/\.relation-list span\s*\{/s);
    expect(figures).toMatch(
      /\.relation-direction,\s*\.relation-undirected\s*\{[^}]*color:\s*var\(--accent-primary-text\);/s,
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

  it("keeps domain graph encodings on their intentional hue families", () => {
    const graph = source("modules/story-world/StoryGraph.css");
    const cardKinds = source("modules/graph/cardPresentation.css");
    expect(graph).toMatch(
      /\.story-node\s*\{[^}]*border-left:\s*3px solid var\(--graph-card-kind-color,/s,
    );
    expect(graph).toMatch(
      /\.story-node\.zoom-overview:not\(\.is-important\)\s*\{[^}]*background:\s*var\(--graph-card-kind-color,/s,
    );
    expect(cardKinds).toMatch(
      /\.graph-card-kind--ort\s*\{[^}]*--graph-card-kind-color:\s*var\(--card-kind-ort\);/s,
    );
    expect(cardKinds).toMatch(
      /\.graph-card-kind--konzept\s*\{[^}]*--graph-card-kind-color:\s*var\(--card-kind-konzept\);/s,
    );
    expect(graph).toMatch(/\.story-node strong svg\s*\{[^}]*color:\s*var\(--rose-text\);/s);

    const inspector = source("modules/story-world/figures/FigureInspector.css");
    expect(inspector).toMatch(
      /\.timeline-life-action\.active\s*\{[^}]*border-color:\s*var\(--error-border\);[^}]*background:\s*var\(--error-bg\);[^}]*color:\s*var\(--error-text\);/s,
    );

    const edgePresentation = source("modules/graph/edgePresentation.css");
    expect(edgePresentation).toMatch(
      /\.edge-directed\s*\{[^}]*--graph-relationship-edge-color:\s*var\(--graph-edge-directed-stroke\);/s,
    );
    expect(edgePresentation).toMatch(
      /\.edge-undirected\s*\{[^}]*--graph-relationship-edge-color:\s*var\(--graph-edge-undirected-stroke\);/s,
    );
    const temporalRule = edgePresentation.match(
      /\.react-flow__edge\.graph-relationship-edge\.edge-temporal \.react-flow__edge-path\s*\{([^}]*)\}/s,
    )?.[1];
    expect(temporalRule).toBeDefined();
    expect(temporalRule).not.toContain("stroke:");
    expect(temporalRule).not.toContain("stroke-dasharray:");
    const solidRule = edgePresentation.match(
      /\.react-flow__edge\.graph-relationship-edge \.react-flow__edge-path\s*\{([^}]*)\}/s,
    )?.[1];
    expect(solidRule).toBeDefined();
    expect(solidRule).not.toContain("stroke-dasharray:");
    expect(edgePresentation).toMatch(
      /\.edge-line-dashed \.react-flow__edge-path\s*\{[^}]*stroke-dasharray:/s,
    );
    expect(edgePresentation).toMatch(
      /\.edge-line-dotted \.react-flow__edge-path\s*\{[^}]*stroke-dasharray:/s,
    );
    expect(edgePresentation).not.toContain("edge-blood");

    const canvas = source("modules/story-world/figures/FigureCanvas.css");
    expect(canvas).toMatch(/\.story-node \.neutral-handle\s*\{[^}]*background:\s*var\(--moss\);/s);
  });

  it("keeps selection, focus and drag targets on distinct semantic roles", () => {
    const binder = source("modules/manuscript/ChapterFolderTree.css");
    expect(binder).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);/s);
    expect(binder).toMatch(
      /\.binder-folder-row\.is-drop-target\s*\{[^}]*border-color:\s*var\(--drop-target-border\);[^}]*background:\s*var\(--drop-target-surface\);/s,
    );

    const history = source("modules/history/HistoryDialog.css");
    expect(history).toMatch(
      /\.diff-summary-button\[aria-expanded="true"\]\s*\{[^}]*border-color:\s*var\(--selection-border\);/s,
    );
  });
});
