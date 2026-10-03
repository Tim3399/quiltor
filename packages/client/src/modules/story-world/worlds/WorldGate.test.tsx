import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("offers DOCX manuscript import as a new-project flow at project selection", () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    renderGate([world("paper")], {
      onOpen,
      onProjectImported: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: "Manuskript importieren" }));

    expect(screen.getByRole("dialog", { name: "Manuskript importieren" })).toBeInTheDocument();
    expect(screen.getByText(/neues Projekt erstellt/i)).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("offers project import at project selection without opening an existing world", () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    renderGate([world("paper")], {
      onOpen,
      onProjectImported: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.click(screen.getByRole("button", { name: "Projekt importieren" }));
    expect(screen.getByRole("dialog", { name: "Quiltor-Projekt importieren" })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

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
    expect(
      screen.getByRole("alertdialog", { name: "Welt in Papierkorb verschieben" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/in den Papierkorb verschoben/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In Papierkorb verschieben" })).toBeInTheDocument();
  });

  it("undoes only the world that was just moved to trash", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    renderGate([world("paper", "Die Stadt aus Papier")], {
      onDelete,
      onRestore,
      onLoadTrash: vi.fn().mockResolvedValue(undefined),
      onPurge: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: "Die Stadt aus Papier – Welt löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "In Papierkorb verschieben" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rückgängig" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith("paper"));
  });

  it.each(["restore", "purge"] as const)(
    "clears stale undo after the same world is %s from trash",
    async (action) => {
      const trashed = {
        ...world("paper", "Die Stadt aus Papier"),
        deletedAt: "2026-08-24T12:00:00Z",
      };
      const onRestore = vi.fn().mockResolvedValue(undefined);
      const onPurge = vi.fn().mockResolvedValue(undefined);
      renderGate([trashed], {
        trash: [trashed],
        onDelete: vi.fn().mockResolvedValue(undefined),
        onLoadTrash: vi.fn().mockResolvedValue(undefined),
        onRestore,
        onPurge,
      });

      fireEvent.click(screen.getByRole("button", { name: "Die Stadt aus Papier – Welt löschen" }));
      fireEvent.click(screen.getByRole("button", { name: "In Papierkorb verschieben" }));
      await screen.findByRole("button", { name: "Rückgängig" });
      fireEvent.click(screen.getByRole("button", { name: "Papierkorb" }));

      if (action === "restore") {
        fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));
        await waitFor(() => expect(onRestore).toHaveBeenCalledWith("paper"));
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
        const dialog = screen.getByRole("alertdialog", { name: "Welt endgültig löschen" });
        const purge = within(dialog).getByRole("button", {
          name: "Endgültig löschen – gedrückt halten zum Bestätigen",
        });
        vi.useFakeTimers();
        try {
          fireEvent.pointerDown(purge, { pointerId: 1 });
          await vi.advanceTimersByTimeAsync(1600);
          expect(onPurge).toHaveBeenCalledWith("paper");
        } finally {
          vi.useRealTimers();
        }
      }

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Rückgängig" })).not.toBeInTheDocument(),
      );
    },
  );

  it("offers accessible restore and confirmed permanent deletion from trash", async () => {
    const onLoadTrash = vi.fn().mockResolvedValue(undefined);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onPurge = vi.fn().mockResolvedValue(undefined);
    renderGate([], {
      trash: [{ ...world("paper", "Die Stadt aus Papier"), deletedAt: "2026-08-24T12:00:00Z" }],
      onLoadTrash,
      onRestore,
      onPurge,
    });

    fireEvent.click(screen.getByRole("button", { name: "Papierkorb" }));
    expect(onLoadTrash).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Papierkorb" })).toBeInTheDocument();
    expect(screen.getByText("Die Stadt aus Papier")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    expect(screen.getByRole("alertdialog", { name: "Welt endgültig löschen" })).toBeInTheDocument();
    expect(screen.getByText(/alle lokalen Sicherungen/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Endgültig löschen – gedrückt halten zum Bestätigen",
      }),
    );
    expect(onPurge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onPurge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));
    expect(onRestore).toHaveBeenCalledWith("paper");
  });

  it("shows loading, empty, and error trash states", () => {
    const callbacks = {
      onLoadTrash: vi.fn().mockResolvedValue(undefined),
      onRestore: vi.fn().mockResolvedValue(undefined),
      onPurge: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(
      <I18nProvider>
        <WorldGate
          worlds={[]}
          theme="system"
          onTheme={vi.fn()}
          onOpen={vi.fn()}
          onCreate={vi.fn()}
          onDelete={vi.fn()}
          trash={null}
          {...callbacks}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Papierkorb" }));
    expect(screen.getByRole("status")).toHaveTextContent("Papierkorb wird geladen");

    rerender(
      <I18nProvider>
        <WorldGate
          worlds={[]}
          theme="system"
          onTheme={vi.fn()}
          onOpen={vi.fn()}
          onCreate={vi.fn()}
          onDelete={vi.fn()}
          trash={[]}
          trashError="Nicht erreichbar"
          {...callbacks}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Nicht erreichbar");
    fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
    expect(callbacks.onLoadTrash).toHaveBeenCalledTimes(2);
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
