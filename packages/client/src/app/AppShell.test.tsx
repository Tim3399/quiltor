import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
          onVersions={() => undefined}
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
    const versions = vi.fn(),
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
          onVersions={versions}
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
    // One entry leads to versions, backups and sync alike; the four it replaced are gone.
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Zur Weltauswahl",
      "Versionen & Sicherungen",
      "Projekt exportieren",
      "Erste Schritte",
      "Dunkel",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Versionen & Sicherungen" }));
    expect(versions).toHaveBeenCalledOnce();
    expect(more).toHaveFocus();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "Zur Weltauswahl" }));
    expect(exitWorld).toHaveBeenCalledOnce();
    expect(more).toHaveFocus();
  });

  it("offers no versions, backups or sync while the world is an example preview", () => {
    const shell = (onVersions?: () => void) => (
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
          onVersions={onVersions}
          onAssistant={() => undefined}
          onExitWorld={() => undefined}
        >
          <div />
        </AppShell>
      </I18nProvider>
    );
    const { rerender } = render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    expect(
      screen.queryByRole("menuitem", { name: "Versionen & Sicherungen" }),
    ).not.toBeInTheDocument();
    // Once the preview has become real, the entry is back.
    rerender(shell(() => undefined));
    expect(screen.getByRole("menuitem", { name: "Versionen & Sicherungen" })).toBeInTheDocument();
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
          onVersions={() => undefined}
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

  it("lets a saved state age while it is on screen, and starts from the clock when it appears", () => {
    vi.useFakeTimers();
    try {
      const start = Date.UTC(2026, 8, 3, 12, 0, 0);
      vi.setSystemTime(start);
      const shell = (phase: "dirty" | "saved") => (
        <I18nProvider>
          <AppShell
            title="Welt"
            workspace="text"
            onWorkspace={() => undefined}
            phase={phase}
            savedAt={start - 4 * 60_000}
            retry={() => undefined}
            theme="light"
            onTheme={() => undefined}
            onSearch={() => undefined}
            onVersions={() => undefined}
            onAssistant={() => undefined}
            onExitWorld={() => undefined}
          >
            <div />
          </AppShell>
        </I18nProvider>
      );
      const view = render(shell("dirty"));
      expect(screen.getByRole("status")).not.toHaveTextContent("vor");
      const idleTimers = vi.getTimerCount();

      // Minutes pass while nothing re-renders the bar; the saved state then appears.
      act(() => vi.setSystemTime(start + 60_000));
      view.rerender(shell("saved"));
      expect(screen.getByRole("status")).toHaveTextContent("vor 5 Min.");
      // The clock runs only while there is an age to show.
      expect(vi.getTimerCount()).toBe(idleTimers + 1);

      act(() => vi.advanceTimersByTime(120_000));
      expect(screen.getByRole("status")).toHaveTextContent("vor 7 Min.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show a minute too little while the clock sits between two ticks", () => {
    vi.useFakeTimers();
    try {
      // The bar is first drawn 1 s past a tick boundary, while there is nothing to age; the
      // saved state appears 29 s past it, saved exactly five minutes before that.
      const boundary = Date.UTC(2026, 8, 3, 12, 0, 0);
      const now = boundary + 29_000;
      const shell = (phase: "dirty" | "saved") => (
        <I18nProvider>
          <AppShell
            title="Welt"
            workspace="text"
            onWorkspace={() => undefined}
            phase={phase}
            savedAt={now - 5 * 60_000}
            retry={() => undefined}
            theme="light"
            onTheme={() => undefined}
            onSearch={() => undefined}
            onVersions={() => undefined}
            onAssistant={() => undefined}
            onExitWorld={() => undefined}
          >
            <div />
          </AppShell>
        </I18nProvider>
      );
      vi.setSystemTime(boundary + 1_000);
      const view = render(shell("dirty"));
      act(() => vi.setSystemTime(now));
      view.rerender(shell("saved"));
      expect(screen.getByRole("status")).toHaveTextContent("vor 5 Min.");
    } finally {
      vi.useRealTimers();
    }
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
          onVersions={() => undefined}
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
          onVersions={() => undefined}
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
