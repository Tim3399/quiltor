import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

afterEach(cleanup);

describe("Menu", () => {
  it("moves across enabled items and closes with Escape", async () => {
    const close = vi.fn();
    render(
      <Menu label="Aktionen" onClose={close}>
        <MenuItem label="Erste" onSelect={() => undefined} />
        <MenuItem label="Gesperrt" disabled onSelect={() => undefined} />
        <MenuItem label="Letzte" onSelect={() => undefined} />
      </Menu>,
    );
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Erste" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Letzte" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Erste" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "l" });
    expect(screen.getByRole("menuitem", { name: "Letzte" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("selects and closes an item once", () => {
    const select = vi.fn();
    const close = vi.fn();
    render(
      <Menu label="Aktionen" onClose={close} autoFocus={false}>
        <MenuItem label="Ausführen" shortcut="⌘K" onSelect={select} />
        <MenuSeparator />
      </Menu>,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Ausführen/ }));
    expect(select).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
