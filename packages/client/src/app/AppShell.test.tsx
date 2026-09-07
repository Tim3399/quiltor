import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  it("keeps secondary tools in a keyboard-accessible overflow menu", () => {
    const history = vi.fn(),
      snapshot = vi.fn(),
      backups = vi.fn(),
      exitWorld = vi.fn();
    render(
      <I18nProvider>
        <AppShell
          title="Welt"
          workspace="text"
          onWorkspace={() => undefined}
          phase="idle"
          retry={() => undefined}
          theme="light"
          onTheme={() => undefined}
          onSearch={() => undefined}
          onHistory={history}
          onSnapshot={snapshot}
          onBackups={backups}
          onAssistant={() => undefined}
          onExitWorld={exitWorld}
        >
          <div />
        </AppShell>
      </I18nProvider>,
    );
    for (const name of ["Text", "Figuren", "Timeline", "Orte"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-label", name);
    }
    const more = screen.getByRole("button", { name: "Mehr" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Verlauf" }));
    expect(history).toHaveBeenCalledOnce();
    expect(more).toHaveFocus();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "Zur Weltauswahl" }));
    expect(exitWorld).toHaveBeenCalledOnce();
    expect(more).toHaveFocus();
  });

  it("says how old a saved state is, but only once it has an age", () => {
    const now = Date.UTC(2026, 8, 3, 12, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const shell = (savedAt: number) => (
      <I18nProvider>
        <AppShell
          title="Welt"
          workspace="text"
          onWorkspace={() => undefined}
          phase="saved"
          savedAt={savedAt}
          retry={() => undefined}
          theme="light"
          onTheme={() => undefined}
          onSearch={() => undefined}
          onHistory={() => undefined}
          onSnapshot={() => undefined}
          onBackups={() => undefined}
          onAssistant={() => undefined}
          onExitWorld={() => undefined}
        >
          <div />
        </AppShell>
      </I18nProvider>
    );

    const view = render(shell(now - 20_000));
    expect(screen.getByRole("status")).toHaveTextContent("Gespeichert");
    expect(screen.getByRole("status")).not.toHaveTextContent("vor");

    view.rerender(shell(now - 5 * 60_000));
    expect(screen.getByRole("status")).toHaveTextContent("Gespeichert · vor 5 Min.");
  });

  it("keeps the save state in the bar and the document facts in the status line", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(
      <I18nProvider>
        <AppShell
          title="Welt"
          workspace="text"
          onWorkspace={() => undefined}
          phase="saved"
          retry={() => undefined}
          theme="light"
          onTheme={() => undefined}
          onSearch={() => undefined}
          onHistory={() => undefined}
          onSnapshot={() => undefined}
          onBackups={() => undefined}
          onAssistant={() => undefined}
          onExitWorld={() => undefined}
          summary={<span>4 Kapitel</span>}
        >
          <div />
        </AppShell>
      </I18nProvider>,
    );

    // Below stands what is open; above in the bar, what the application does with it.
    const bar = screen.getByRole("contentinfo", { name: "Arbeitsstand" });
    expect(bar).toHaveTextContent("4 Kapitel");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Gespeichert");
    expect(bar.contains(status)).toBe(false);
    expect(status.closest("header")).not.toBeNull();

    // It stays visible, even on the narrowest device -- no more moving into the menu.
    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    expect(status.closest('[role="menu"]')).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
