import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryGraphCanvas } from "./StoryGraphCanvas";

vi.mock("@xyflow/react", () => ({
  BackgroundVariant: { Lines: "lines" },
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />,
  ReactFlow: ({ children }: { children: ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
}));

afterEach(cleanup);

describe("StoryGraphCanvas", () => {
  it("provides graph chrome and suppresses the overview grid", () => {
    render(
      <StoryGraphCanvas
        nodes={[{ id: "node", position: { x: 0, y: 0 }, data: {} }]}
        edges={[]}
        zoomTier="overview"
        gridSize={20}
        flowProps={{}}
        overlay={<span>Mode</span>}
      >
        <span>Empty</span>
      </StoryGraphCanvas>,
    );

    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
    expect(screen.getByTestId("minimap")).toBeInTheDocument();
    expect(screen.queryByTestId("background")).not.toBeInTheDocument();
    expect(screen.getByText("Mode")).toBeInTheDocument();
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("keeps the shared figure and place navigation controls touch-safe", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/StoryGraph.css"),
      "utf8",
    );
    const touchRules = css.match(
      /@media \(max-width: 719px\), \(pointer: coarse\)\s*\{([\s\S]*)\}\s*$/,
    )?.[1];

    expect(touchRules).toMatch(
      /\.flow-area \.react-flow__controls-button\s*\{[^}]*width:\s*var\(--control-touch\);[^}]*height:\s*var\(--control-touch\);/s,
    );
    expect(touchRules).toMatch(
      /\.flow-area \.react-flow__controls-button svg\s*\{[^}]*max-width:\s*var\(--space-16\);[^}]*max-height:\s*var\(--space-16\);/s,
    );
    expect(touchRules).toMatch(
      /\.flow-area \.react-flow__attribution a\s*\{[^}]*min-width:\s*var\(--control-touch\);[^}]*min-height:\s*var\(--control-touch\);/s,
    );
  });

  it("maps the third-party graph controls onto the active Quiltor theme", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/StoryGraph.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.flow-area \.react-flow\s*\{[^}]*--xy-controls-button-background-color:\s*var\(--paper\);[^}]*--xy-controls-button-background-color-hover:\s*var\(--panel\);[^}]*--xy-controls-button-color:\s*var\(--ink\);[^}]*--xy-controls-button-border-color:\s*var\(--line\);/s,
    );
    expect(css).toMatch(
      /\.flow-area \.react-flow\s*\{[^}]*--xy-attribution-background-color:\s*var\(--paper\);[^}]*--xy-minimap-background-color:\s*var\(--panel\);/s,
    );
    expect(css).toMatch(
      /\.flow-area \.react-flow__attribution a\s*\{[^}]*color:\s*var\(--attribution\);/s,
    );
  });
});
