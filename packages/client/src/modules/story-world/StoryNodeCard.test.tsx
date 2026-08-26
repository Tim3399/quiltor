import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoryNodeCard } from "./StoryNodeCard";

afterEach(cleanup);

describe("StoryNodeCard", () => {
  it("centralizes graph-node state classes", () => {
    render(
      <StoryNodeCard
        data-testid="node"
        zoomTier="overview"
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
});
