import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chip, ChipAction, ChipList, RemovableChip } from "./Chip";

afterEach(cleanup);

describe("Chip", () => {
  it("groups static, selectable and removable chips without nested controls", () => {
    const remove = vi.fn();
    render(
      <ChipList label="Begriffe">
        <Chip>Hafen</Chip>
        <ChipAction selected>Meer</ChipAction>
        <RemovableChip removeLabel="Sturm entfernen" onRemove={remove}>
          Sturm
        </RemovableChip>
      </ChipList>,
    );
    expect(screen.getByRole("list", { name: "Begriffe" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Meer" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Sturm entfernen" }));
    expect(remove).toHaveBeenCalledOnce();
    expect(document.querySelector("button button")).not.toBeInTheDocument();
  });
});
