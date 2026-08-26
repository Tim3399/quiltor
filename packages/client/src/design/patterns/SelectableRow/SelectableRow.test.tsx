import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "../../primitives/IconButton";
import { SelectableRow } from "./SelectableRow";

afterEach(cleanup);

describe("SelectableRow", () => {
  it("extends SelectionCard without nesting its independent trailing action", () => {
    const select = vi.fn();
    render(
      <SelectableRow
        label="Kapitel öffnen"
        title="Die Ankunft"
        description="Erstes Kapitel"
        metadata="1.240 Wörter"
        selected
        onSelect={select}
        actionsLabel="Kapitelaktionen"
        actions={<IconButton label="Kapitel löschen" icon={<span>×</span>} />}
      />,
    );
    const primary = screen.getByRole("button", { name: "Kapitel öffnen" });
    expect(primary).toHaveAttribute("aria-current", "true");
    fireEvent.click(primary);
    expect(select).toHaveBeenCalledOnce();
    expect(screen.getByRole("group", { name: "Kapitelaktionen" })).toBeVisible();
    expect(document.querySelector("button button")).not.toBeInTheDocument();
  });
});
