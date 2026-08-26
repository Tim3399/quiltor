import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../../i18n";
import { TimeSystemControls } from "./TimeSystemControls";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Controls({ onKindChange = vi.fn(), onPatch = vi.fn() }) {
  const { locale, t } = useI18n();
  return (
    <TimeSystemControls
      system={DEFAULT_TIME_SYSTEM}
      onKindChange={onKindChange}
      onPatch={onPatch}
      locale={locale}
      t={t}
    />
  );
}

describe("TimeSystemControls", () => {
  it("delegates its portalled settings overflow to the public ScrollArea contract", () => {
    render(
      <I18nProvider>
        <Controls />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zeitsystem konfigurieren" }));
    const panel = document.querySelector(".timeline-time-settings-panel");
    expect(panel?.tagName).toBe("DIV");
    expect(panel).toHaveClass("scroll-area", "timeline-time-settings-panel");
    expect(panel).toHaveAttribute("data-axis", "y");
    expect(panel).toHaveAttribute("data-gutter", "stable");
    expect(panel).toHaveAttribute("data-overscroll", "auto");
    expect(panel).toHaveAttribute("data-scrollbar", "thin");
    expect(panel).toHaveAttribute("data-surface", "panel");

    const css = readFileSync(
      join(
        process.cwd(),
        "packages/client/src/modules/story-world/timeline/TimeSystemControls.css",
      ),
      "utf8",
    );
    expect(css).toMatch(
      /\.timeline-time-settings-panel\s*\{[^}]*max-height:\s*min\(620px, calc\(100dvh - var\(--space-88\)\)\);[^}]*display:\s*grid;/s,
    );
    expect(css).not.toMatch(
      /\.timeline-time-settings-panel\s*\{[^}]*(?:position:\s*absolute|z-index:)/s,
    );
    expect(css).not.toMatch(
      /\.timeline-time-settings-panel(?:\s*\{|::)[^}]*(?:overflow|scrollbar|--scrollbar-surface)/s,
    );
    expect(css).not.toContain(".timeline-time-settings-panel::-webkit-scrollbar");
  });

  it("adds a custom calendar and opens its labelled settings popover in one action", () => {
    const onKindChange = vi.fn();
    render(
      <I18nProvider>
        <Controls onKindChange={onKindChange} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kalender hinzufügen" }));
    expect(onKindChange).toHaveBeenCalledWith("custom");
    expect(screen.getByRole("button", { name: "Zeitsystem konfigurieren" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("dialog", { name: "Zeitsystem konfigurieren" })).toBeVisible();
  });

  it("keeps the settings trigger named when its visible label is hidden on mobile", () => {
    render(
      <I18nProvider>
        <Controls />
      </I18nProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Zeitsystem konfigurieren" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on outside input and restores focus to its trigger", async () => {
    render(
      <I18nProvider>
        <Controls />
      </I18nProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Zeitsystem konfigurieren" });
    fireEvent.click(trigger);
    const panel = document.querySelector<HTMLElement>(".timeline-time-settings-panel");
    await waitFor(() => expect(panel).toHaveFocus());

    fireEvent.pointerDown(document.body);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Zeitsystem konfigurieren" })).toBeNull(),
    );
    expect(trigger).toHaveFocus();
  });

  it("adapts to a compact modal sheet and closes it with Escape", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(
      <I18nProvider>
        <Controls />
      </I18nProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Zeitsystem konfigurieren" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Zeitsystem konfigurieren" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() =>
      expect(document.querySelector(".timeline-time-settings-panel")).toHaveFocus(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Zeitsystem konfigurieren" })).toBeNull(),
    );
    expect(trigger).toHaveFocus();
  });

  it("uses a designed listbox instead of a native select for system switching", () => {
    const onKindChange = vi.fn();
    render(
      <I18nProvider>
        <Controls onKindChange={onKindChange} />
      </I18nProvider>,
    );
    const control = screen.getByRole("combobox", { name: "Zeitsystem" });
    expect(control.tagName).toBe("BUTTON");
    fireEvent.click(control);
    fireEvent.click(screen.getByRole("option", { name: "Gregorianisch" }));
    expect(onKindChange).toHaveBeenCalledWith("gregorian");
  });
});
