import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SidePanel, SidePanelBody, SidePanelEmpty, SidePanelHeader } from "./SidePanel";

afterEach(cleanup);

describe("SidePanel", () => {
  it("composes a named side panel with explicit structural regions", () => {
    render(
      <SidePanel label="Figurinspektor" side="end">
        <SidePanelHeader title="Details" actions={<button type="button">Schließen</button>} />
        <SidePanelBody>Inhalt</SidePanelBody>
      </SidePanel>,
    );
    const panel = screen.getByRole("complementary", { name: "Figurinspektor" });
    expect(panel).toHaveAttribute("data-side", "end");
    expect(screen.getByText("Inhalt")).toHaveClass("side-panel__body");
  });

  it("provides a consistent empty state", () => {
    render(
      <SidePanel label="Auswahl">
        <SidePanelEmpty title="Nichts ausgewählt">Wähle einen Eintrag.</SidePanelEmpty>
      </SidePanel>,
    );
    expect(screen.getByRole("heading", { name: "Nichts ausgewählt" })).toBeVisible();
  });

  it("can fill an overlay host without requiring a product CSS override", () => {
    render(
      <SidePanel label="Kapitel" side="start" width="fill">
        Inhalt
      </SidePanel>,
    );

    expect(screen.getByRole("complementary", { name: "Kapitel" })).toHaveAttribute(
      "data-width",
      "fill",
    );
  });
});
