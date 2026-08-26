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
});
