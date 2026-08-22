import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../../i18n";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";
import { TimeSystemControls } from "./TimeSystemControls";

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
