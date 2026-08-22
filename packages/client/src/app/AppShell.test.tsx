import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("keeps secondary tools in a keyboard-accessible overflow menu", () => {
    const history = vi.fn(),
      snapshot = vi.fn(),
      backups = vi.fn();
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
        >
          <div />
        </AppShell>
      </I18nProvider>,
    );
    const more = screen.getByRole("button", { name: "Mehr" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Verlauf" }));
    expect(history).toHaveBeenCalledOnce();
    expect(more).toHaveFocus();
  });
});
