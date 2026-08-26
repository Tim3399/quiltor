import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItem } from "../../components/Menu";
import { DropdownMenu } from "./DropdownMenu";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTrigger({
  ref,
  ...props
}: Parameters<React.ComponentProps<typeof DropdownMenu>["renderTrigger"]>[0]) {
  return (
    <button ref={ref} {...props}>
      Aktionen
    </button>
  );
}

describe("DropdownMenu", () => {
  it("owns trigger state and closes after selection", async () => {
    const select = vi.fn();
    render(
      <DropdownMenu label="Aktionen" renderTrigger={renderTrigger}>
        <MenuItem label="Umbenennen" onSelect={select} />
      </DropdownMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Aktionen" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
    expect(screen.queryByRole("dialog", { name: "Aktionen" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Umbenennen" })).toHaveFocus());
    fireEvent.click(screen.getByRole("menuitem", { name: "Umbenennen" }));
    expect(select).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens from ArrowUp and focuses the last enabled action", async () => {
    render(
      <DropdownMenu label="Aktionen" renderTrigger={renderTrigger}>
        <MenuItem label="Erste" onSelect={() => undefined} />
        <MenuItem label="Gesperrt" disabled onSelect={() => undefined} />
        <MenuItem label="Letzte" onSelect={() => undefined} />
      </DropdownMenu>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Aktionen" }), { key: "ArrowUp" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Letzte" })).toHaveFocus());
  });

  it("renders non-action content outside the menu semantics", () => {
    render(
      <DropdownMenu
        label="Aktionen"
        defaultOpen
        header={<span role="status">Gespeichert</span>}
        renderTrigger={renderTrigger}
      >
        <MenuItem label="Umbenennen" onSelect={() => undefined} />
      </DropdownMenu>,
    );

    const status = screen.getByRole("status");
    expect(status.closest('[role="menu"]')).toBeNull();
  });

  it("opens from ArrowDown and reports controlled changes", () => {
    const change = vi.fn();
    render(
      <DropdownMenu
        label="Aktionen"
        open={false}
        onOpenChange={change}
        renderTrigger={renderTrigger}
      >
        <MenuItem label="Umbenennen" onSelect={() => undefined} />
      </DropdownMenu>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Aktionen" }), { key: "ArrowDown" });
    expect(change).toHaveBeenCalledWith(true);
  });

  it("keeps focus on the first action in compact sheet mode and closes once with Escape", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const change = vi.fn();
    render(
      <DropdownMenu
        label="Aktionen"
        defaultOpen
        onOpenChange={change}
        renderTrigger={renderTrigger}
      >
        <MenuItem label="Umbenennen" onSelect={() => undefined} />
        <MenuItem label="Löschen" onSelect={() => undefined} />
      </DropdownMenu>,
    );

    const first = screen.getByRole("menuitem", { name: "Umbenennen" });
    expect(screen.getByRole("dialog", { name: "Aktionen" })).toHaveClass(
      "ui-popover-sheet-container",
    );
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: "Escape" });

    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
