import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppShell } from "./AppShell";

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
});
