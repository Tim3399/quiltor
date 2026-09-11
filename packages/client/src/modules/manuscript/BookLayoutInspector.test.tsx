import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { BookLayoutInspector } from "./BookLayoutInspector";
import { type BookLayoutSettings, resolveBookLayout } from "./bookLayout";

afterEach(cleanup);

function InspectorHarness({ initial = resolveBookLayout() }: { initial?: BookLayoutSettings }) {
  const [settings, setSettings] = useState(initial);
  return (
    <I18nProvider>
      <BookLayoutInspector settings={settings} onChange={setSettings} onClose={() => {}} />
      <output data-testid="settings">{JSON.stringify(settings)}</output>
    </I18nProvider>
  );
}

describe("BookLayoutInspector", () => {
  it("applies a page format with its physical dimensions", () => {
    render(<InspectorHarness />);
    fireEvent.change(screen.getByLabelText("Seitenformat"), { target: { value: "a5" } });
    const settings = JSON.parse(screen.getByTestId("settings").textContent || "{}");
    expect(settings).toMatchObject({ pageFormat: "a5", pageWidthMm: 148, pageHeightMm: 210 });
  });

  it("keeps metadata when a preset is applied", () => {
    render(
      <InspectorHarness
        initial={{ ...resolveBookLayout(), bookTitle: "Nordlicht", author: "Mara" }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Vorlage" }), {
      target: { value: "classic-paperback" },
    });
    const settings = JSON.parse(screen.getByTestId("settings").textContent || "{}");
    expect(settings).toMatchObject({
      preset: "classic-paperback",
      bookTitle: "Nordlicht",
      author: "Mara",
    });
  });

  it("does not persist an empty or out-of-range numeric draft", () => {
    render(<InspectorHarness />);
    const fontSize = screen.getByLabelText("Schriftgröße (pt)");
    fireEvent.change(fontSize, { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("settings").textContent || "{}").fontSizePt).toBe(10.75);
    fireEvent.change(fontSize, { target: { value: "80" } });
    expect(JSON.parse(screen.getByTestId("settings").textContent || "{}").fontSizePt).toBe(10.75);
    fireEvent.change(screen.getByLabelText("Hurenkinder"), { target: { value: "2.5" } });
    expect(JSON.parse(screen.getByTestId("settings").textContent || "{}").widows).toBe(3);
  });
});
