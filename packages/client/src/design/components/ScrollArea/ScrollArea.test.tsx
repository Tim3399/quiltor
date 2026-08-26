import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ScrollArea } from "./ScrollArea";

afterEach(cleanup);

describe("ScrollArea", () => {
  it("uses a neutral div and visual scrollbar defaults without inventing semantics", () => {
    render(<ScrollArea data-testid="scroll-area">Arvandor</ScrollArea>);

    const area = screen.getByTestId("scroll-area");
    expect(area.tagName).toBe("DIV");
    expect(area).toHaveClass("scroll-area");
    expect(area).not.toHaveAttribute("role");
    expect(area).not.toHaveAttribute("tabindex");
    expect(area).toHaveAttribute("data-axis", "y");
    expect(area).toHaveAttribute("data-gutter", "stable");
    expect(area).toHaveAttribute("data-overscroll", "contain");
    expect(area).toHaveAttribute("data-scrollbar", "thin");
    expect(area).toHaveAttribute("data-surface", "transparent");
  });

  it("preserves native semantics and forwards the correctly typed element ref", () => {
    const ref = createRef<HTMLUListElement>();
    render(
      <ScrollArea
        as="ul"
        ref={ref}
        aria-label="Welten"
        surface="panel"
        className="world-list"
        style={{ maxHeight: 240 }}
      >
        <li>Arvandor</li>
      </ScrollArea>,
    );

    const list = screen.getByRole("list", { name: "Welten" });
    expect(list).toBe(ref.current);
    expect(list).toHaveClass("scroll-area", "world-list");
    expect(list).toHaveAttribute("data-surface", "panel");
    expect(list).toHaveStyle({ maxHeight: "240px" });
  });

  it("exposes explicit scrolling, gutter, overscroll, and scrollbar variants", () => {
    render(
      <ScrollArea
        data-testid="map-scroll"
        axis="both"
        gutter="both-edges"
        overscroll="auto"
        scrollbar="hidden"
        surface="canvas"
        role="region"
        aria-label="Kartenfläche"
        tabIndex={0}
      />,
    );

    const region = screen.getByRole("region", { name: "Kartenfläche" });
    expect(region).toHaveAttribute("data-axis", "both");
    expect(region).toHaveAttribute("data-gutter", "both-edges");
    expect(region).toHaveAttribute("data-overscroll", "auto");
    expect(region).toHaveAttribute("data-scrollbar", "hidden");
    expect(region).toHaveAttribute("data-surface", "canvas");
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("owns the complete Quiltor scrollbar and opt-in focus contract", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/design/components/ScrollArea/ScrollArea.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.scroll-area\[data-scrollbar="thin"\]\s*\{[^}]*scrollbar-color:\s*var\(--gold-border\)\s+var\(--transparent\);[^}]*scrollbar-width:\s*thin;/s,
    );
    expect(css).toContain('.scroll-area[data-gutter="stable"]');
    expect(css).toContain("scrollbar-gutter: stable;");
    expect(css).toContain("scrollbar-gutter: stable both-edges;");
    expect(css).toContain('.scroll-area[data-surface="canvas"]');
    expect(css).toContain('.scroll-area[data-surface="paper"]');
    expect(css).toContain('.scroll-area[data-surface="panel"]');
    expect(css).toMatch(
      /\.scroll-area\[data-scrollbar="thin"\]::-webkit-scrollbar-thumb\s*\{[^}]*border:\s*var\(--space-3\)\s+solid\s+var\(--scrollbar-surface\);[^}]*background:\s*var\(--gold-border\);/s,
    );
    expect(css).toMatch(
      /\.scroll-area\[data-scrollbar="thin"\]::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*var\(--gold\);/s,
    );
    expect(css).toMatch(
      /\.scroll-area\[data-scrollbar="thin"\]::-webkit-scrollbar-thumb:active\s*\{[^}]*background:\s*var\(--gold-text\);/s,
    );
    expect(css).toMatch(
      /\.scroll-area:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--focus\);/s,
    );
  });
});
