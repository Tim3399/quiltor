import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../../i18n";
import { TimeSystemControls } from "./TimeSystemControls";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";

afterEach(cleanup);

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
  it("delegates its vertical settings overflow to the public ScrollArea contract", () => {
    const { container } = render(
      <I18nProvider>
        <Controls />
      </I18nProvider>,
    );
    const panel = container.querySelector(".timeline-time-settings-panel");
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
      /\.timeline-time-settings-panel\s*\{[^}]*max-height:\s*min\(620px, 75vh\);[^}]*display:\s*grid;/s,
    );
    expect(css).not.toMatch(
      /\.timeline-time-settings-panel(?:\s*\{|::)[^}]*(?:overflow|scrollbar|--scrollbar-surface)/s,
    );
    expect(css).not.toContain(".timeline-time-settings-panel::-webkit-scrollbar");
  });

  it("adds a custom calendar and opens its settings in one action", () => {
    const onKindChange = vi.fn();
    render(
      <I18nProvider>
        <Controls onKindChange={onKindChange} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kalender hinzufügen" }));
    expect(onKindChange).toHaveBeenCalledWith("custom");
    expect(screen.getByText("Zeitsystem konfigurieren").closest("details")).toHaveAttribute("open");
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
