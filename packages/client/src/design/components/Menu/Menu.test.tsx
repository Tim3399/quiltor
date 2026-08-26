import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuItem, MenuSeparator, MenuSubmenu } from "./Menu";

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
    expect(screen.getByRole("menu")).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Erste" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Letzte" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Erste" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Letzte" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Erste" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "l" });
    expect(screen.getByRole("menuitem", { name: "Letzte" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("can focus the last action initially", async () => {
    render(
      <Menu label="Aktionen" initialFocus="last" onClose={() => undefined}>
        <MenuItem label="Erste" onSelect={() => undefined} />
        <MenuItem label="Letzte" onSelect={() => undefined} />
      </Menu>,
    );

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Letzte" })).toHaveFocus());
  });

  it("wraps legacy children in the robust label slot and keeps danger icons visible", () => {
    render(
      <Menu label="Aktionen" onClose={() => undefined} autoFocus={false}>
        <MenuItem tone="danger" onSelect={() => undefined}>
          Ein sehr langer Löschtext
        </MenuItem>
      </Menu>,
    );

    const item = screen.getByRole("menuitem", { name: "Ein sehr langer Löschtext" });
    expect(item.querySelector(".ui-menu__label")).toHaveTextContent("Ein sehr langer Löschtext");
    expect(item).toHaveAttribute("data-tone", "danger");
  });

  it("keeps a non-closing action open and handles an all-disabled menu", async () => {
    const close = vi.fn();
    const select = vi.fn();
    const { rerender } = render(
      <Menu label="Aktionen" onClose={close}>
        <MenuItem label="Bleibt offen" closeOnSelect={false} onSelect={select} />
      </Menu>,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Bleibt offen" }));
    expect(select).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    rerender(
      <Menu label="Aktionen" onClose={close}>
        <MenuItem label="Gesperrt" disabled onSelect={() => undefined} />
      </Menu>,
    );
    const menu = screen.getByRole("menu");
    menu.focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Gesperrt" })).not.toHaveFocus();
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

  it("opens, returns from and selects through a nested submenu", async () => {
    const closeParent = vi.fn();
    const select = vi.fn();
    render(
      <Menu label="Aktionen" onClose={closeParent}>
        <MenuItem label="Direkt" onSelect={() => undefined} />
        <MenuSubmenu label="Verschieben nach">
          <MenuItem label="Kapitel eins" onSelect={select} />
          <MenuItem label="Kapitel zwei" onSelect={() => undefined} />
        </MenuSubmenu>
      </Menu>,
    );
    const trigger = screen.getByRole("menuitem", { name: "Verschieben nach" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    const firstNested = screen.getByRole("menuitem", { name: "Kapitel eins" });
    await waitFor(() => expect(firstNested).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const nestedMenu = firstNested.closest<HTMLElement>('[role="menu"]');
    expect(nestedMenu).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-controls", nestedMenu?.id ?? "");

    fireEvent.keyDown(firstNested, { key: "ArrowLeft" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(closeParent).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Kapitel eins" })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Kapitel eins" }));
    expect(select).toHaveBeenCalledOnce();
    expect(closeParent).toHaveBeenCalledOnce();
  });
});
