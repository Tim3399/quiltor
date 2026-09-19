import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { GettingStartedDialog } from "./GettingStartedDialog";

afterEach(cleanup);

describe("GettingStartedDialog", () => {
  it.each([
    ["Zum Schreiben", "onWrite"],
    ["Zum Manuskript", "onImportText"],
    ["Suche öffnen", "onSearch"],
    ["Assistent öffnen", "onAssistant"],
  ] as const)("routes %s through its existing application action", (label, action) => {
    const callbacks = {
      onWrite: vi.fn(),
      onImportText: vi.fn(),
      onSearch: vi.fn(),
      onAssistant: vi.fn(),
      onClose: vi.fn(),
    };
    render(
      <I18nProvider>
        <GettingStartedDialog {...callbacks} />
      </I18nProvider>,
    );

    expect(Object.values(callbacks).every((callback) => callback.mock.calls.length === 0)).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(callbacks[action]).toHaveBeenCalledOnce();
  });

  it("states the supported paste and project-import paths without promising a document parser", () => {
    render(
      <I18nProvider>
        <GettingStartedDialog
          onWrite={vi.fn()}
          onImportText={vi.fn()}
          onSearch={vi.fn()}
          onAssistant={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/füge vorhandenen Text sicher ein/)).toBeInTheDocument();
    expect(screen.getByText(/\.quiltor-Projekt/)).toBeInTheDocument();
    expect(screen.queryByText(/DOCX|Scrivener/i)).not.toBeInTheDocument();
  });
});
