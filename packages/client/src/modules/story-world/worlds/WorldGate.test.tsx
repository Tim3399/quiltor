import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { WorldInfo } from "../model";
import { WorldGate } from "./WorldGate";

afterEach(cleanup);

function world(id: string, title = `Welt ${id}`): WorldInfo {
  return {
    id,
    title,
    backupUrl: "",
    updated: "2026-08-23T12:00:00.000Z",
  };
}

function renderGate(
  worlds: WorldInfo[],
  overrides: Partial<ComponentProps<typeof WorldGate>> = {},
) {
  const props: ComponentProps<typeof WorldGate> = {
    worlds,
    theme: "system",
    onTheme: vi.fn(),
    onOpen: vi.fn().mockResolvedValue(undefined),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <I18nProvider>
      <WorldGate {...props} />
    </I18nProvider>,
  );
  return props;
}

describe("WorldGate", () => {
  it("opens creation as a separate sheet and creates only after submission", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderGate([], { onCreate });
    expect(screen.queryByRole("dialog", { name: "Neue Welt" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Neue Welt" }));
    expect(screen.getByRole("dialog", { name: "Neue Welt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Der letzte Garten"), {
      target: { value: "Testwelt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Welt erstellen" }));
    expect(onCreate).toHaveBeenCalledWith("Testwelt", "");
  });

  it("offers an explicit close action in the creation sheet", () => {
    renderGate([]);
    fireEvent.click(screen.getByRole("button", { name: "Neue Welt" }));
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

    expect(screen.queryByRole("dialog", { name: "Neue Welt" })).not.toBeInTheDocument();
  });

  it("opens a world through a spacious selection card while keeping delete independent", () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    renderGate([world("paper", "Die Stadt aus Papier")], { onOpen });

    const open = screen.getByRole("button", {
      name: "Die Stadt aus Papier – Welt öffnen",
    });
    const remove = screen.getByRole("button", {
      name: "Die Stadt aus Papier – Welt löschen",
    });
    expect(open.closest(".selection-card")).toHaveClass("selection-card");
    expect(open).not.toContainElement(remove);

    fireEvent.click(remove);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Welt lokal löschen" })).toBeInTheDocument();
  });

  it("keeps large catalogs bounded and searchable", () => {
    const worlds = Array.from({ length: 52 }, (_, index) =>
      world(String(index + 1), `Chronik ${index + 1}`),
    );
    renderGate(worlds);

    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-long", "true");
    expect(screen.getAllByText(/^Chronik \d+$/)).toHaveLength(52);

    fireEvent.change(screen.getByRole("searchbox", { name: "Suche" }), {
      target: { value: "Chronik 42" },
    });

    expect(screen.getByText("Chronik 42")).toBeInTheDocument();
    expect(screen.queryByText("Chronik 41")).not.toBeInTheDocument();
  });

  it("composes the page and catalog through the public scroll-area contract", () => {
    const worlds = Array.from({ length: 12 }, (_, index) => world(String(index + 1)));
    renderGate(worlds);

    const gate = screen.getByRole("main");
    const list = screen.getByRole("list");
    expect(gate).toHaveClass("scroll-area", "world-gate");
    expect(gate).toHaveAttribute("data-axis", "y");
    expect(gate).toHaveAttribute("data-scrollbar", "thin");
    expect(gate).toHaveAttribute("data-surface", "canvas");
    expect(list).toHaveClass("scroll-area", "world-list");
    expect(list).toHaveAttribute("data-axis", "y");
    expect(list).toHaveAttribute("data-scrollbar", "thin");
    expect(list).toHaveAttribute("data-surface", "panel");
    expect(list.closest(".world-list-panel")).toHaveAttribute("data-long", "true");
  });
});
