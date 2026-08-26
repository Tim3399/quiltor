import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodePriorityActions } from "./NodePriorityActions";

afterEach(cleanup);

describe("NodePriorityActions", () => {
  it("inherits adaptive regular and touch sizing from Button", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/StoryGraph.css"),
      "utf8",
    );
    const tokensCss = readFileSync(
      join(process.cwd(), "packages/client/src/design/tokens.css"),
      "utf8",
    );
    const actionRule = css.match(/\.node-priority-action\s*\{([^}]*)\}/s)?.[1];

    expect(actionRule).toBeDefined();
    expect(actionRule).not.toMatch(/\b(?:min-)?height\s*:/);
    expect(tokensCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?--control-regular:\s*var\(--control-touch\);/,
    );
  });

  it("exposes pressed state and emits the next values", () => {
    const onImportantChange = vi.fn();
    const onPinnedChange = vi.fn();
    render(
      <NodePriorityActions
        important
        pinned={false}
        importantLabel="Unmark important"
        pinnedLabel="Pin position"
        onImportantChange={onImportantChange}
        onPinnedChange={onPinnedChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Unmark important" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Unmark important" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin position" }));
    expect(onImportantChange).toHaveBeenCalledWith(false);
    expect(onPinnedChange).toHaveBeenCalledWith(true);
  });
});
