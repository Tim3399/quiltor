import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  StoryNodeCard,
  StoryNodeIdentity,
  storyNodeCompactLayoutHeight,
  storyNodeCompactLayoutWidth,
} from "./StoryNodeCard";

afterEach(cleanup);

describe("StoryNodeCard", () => {
  it("centralizes graph-node state classes", () => {
    render(
      <StoryNodeCard
        data-testid="node"
        zoomTier="overview"
        viewportZoom={0.2}
        kind="ort"
        accent="gold"
        important
        selected
        dashed
        modifiers={["is-measuring"]}
      />,
    );

    expect(screen.getByTestId("node")).toHaveClass(
      "story-node",
      "zoom-overview",
      "type-ort",
      "accent-gold",
      "is-important",
      "selected",
      "dashed",
      "is-measuring",
    );
  });

  it("owns semantic zoom geometry for every graph-node renderer", () => {
    render(<StoryNodeCard data-testid="node" zoomTier="compact" viewportZoom={0.42} />);

    const node = screen.getByTestId("node");
    expect(node.style.getPropertyValue("--node-compact-height")).toBe(
      `${storyNodeCompactLayoutHeight(0.42, 32.5)}px`,
    );
    expect(node.style.getPropertyValue("--node-compact-touch-height")).toBe(
      `${storyNodeCompactLayoutHeight(0.42, 44.5)}px`,
    );
    expect(node.style.getPropertyValue("--node-compact-width")).toBe(
      `${storyNodeCompactLayoutWidth(0.42, 96.5)}px`,
    );
  });

  it("provides one identity structure for place and figure nodes", () => {
    render(
      <StoryNodeCard zoomTier="detail" viewportZoom={1}>
        <StoryNodeIdentity
          kindLabel="Ort"
          name="Dämmerhafen"
          leading={<span data-testid="leading" />}
          trailing={<span data-testid="trailing" />}
          secondary="An der Nebelküste"
        />
      </StoryNodeCard>,
    );

    expect(screen.getByText("Ort")).toHaveClass("node-kind");
    expect(screen.getByText("D", { selector: ".node-monogram" })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByText("Dämmerhafen", { selector: "strong" })).toContainElement(
      screen.getByTestId("leading"),
    );
    expect(screen.getByText("Dämmerhafen", { selector: "strong" })).toContainElement(
      screen.getByTestId("trailing"),
    );
    expect(screen.getByText("An der Nebelküste", { selector: "small" })).toBeInTheDocument();
  });
});
