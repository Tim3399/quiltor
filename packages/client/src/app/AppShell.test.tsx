import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  it("shows a mirror warning without turning a durable save into an error", () => {
    render(
      <I18nProvider>
        <AppShell
          title="Welt"
          workspace="text"
          onWorkspace={() => undefined}
          phase="saved"
          warning="Lokal gespeichert. Spiegeldatei fehlgeschlagen."
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
      </I18nProvider>,
    );

    expect(screen.getByRole("status")).toHaveAttribute("data-phase", "saved");
    expect(screen.getByRole("status")).toHaveTextContent("Spiegeldatei fehlgeschlagen");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps secondary tools in a keyboard-accessible overflow menu", () => {
    const history = vi.fn(),
      snapshot = vi.fn(),
      backups = vi.fn(),
      exportProject = vi.fn(),
      gettingStarted = vi.fn(),
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
          onExportProject={exportProject}
          onGettingStarted={gettingStarted}
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
    expect(screen.getByRole("menuitem", { name: "Projekt exportieren" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Erste Schritte" })).toBeInTheDocument();
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

  it("opens recovery directly beside a failed save", () => {
    const recover = vi.fn();
    const retry = vi.fn();
    const assistant = vi.fn();
    const search = vi.fn();
    render(
      <I18nProvider>
        <AppShell
          title="Welt"
          workspace="text"
          onWorkspace={() => undefined}
          phase="error"
          error="Speichern fehlgeschlagen"
          retry={retry}
          onRecover={recover}
          theme="light"
          onTheme={() => undefined}
          onSearch={search}
          onHistory={() => undefined}
          onSnapshot={() => undefined}
          onBackups={() => undefined}
          onAssistant={assistant}
          onExitWorld={() => undefined}
        >
          <div />
        </AppShell>
      </I18nProvider>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.closest("header")).toHaveClass("app-bar--save-error");
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Entwurf retten" }));
    expect(recover).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Assistent" }));
    expect(assistant).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Suche" }));
    expect(search).toHaveBeenCalledOnce();
  });
});
