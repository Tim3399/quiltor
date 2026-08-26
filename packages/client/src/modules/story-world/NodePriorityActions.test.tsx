import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodePriorityActions } from "./NodePriorityActions";

afterEach(cleanup);

describe("NodePriorityActions", () => {
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
