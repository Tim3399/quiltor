import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "./Tabs";

afterEach(cleanup);

function Fixture({ activationMode = "automatic" }: { activationMode?: "automatic" | "manual" }) {
  const [value, setValue] = useState("card");
  return (
    <Tabs value={value} onValueChange={setValue} activationMode={activationMode}>
      <TabList label="Figurbereiche">
        <Tab value="card">Karte</Tab>
        <Tab value="profile">Profil</Tab>
        <Tab value="disabled" disabled>
          Gesperrt
        </Tab>
      </TabList>
      <TabPanel value="card">Karteninhalt</TabPanel>
      <TabPanel value="profile">Profilinhalt</TabPanel>
      <TabPanel value="disabled">Gesperrter Inhalt</TabPanel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("links tabs and panels with a roving tab stop", () => {
    render(<Fixture />);
    const card = screen.getByRole("tab", { name: "Karte" });
    const profile = screen.getByRole("tab", { name: "Profil" });
    expect(card).toHaveAttribute("aria-selected", "true");
    expect(card).toHaveAttribute("tabindex", "0");
    expect(profile).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Karteninhalt");
    expect(card.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
  });

  it("wraps arrow navigation, skips disabled tabs and activates automatically", () => {
    render(<Fixture />);
    const card = screen.getByRole("tab", { name: "Karte" });
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowLeft" });
    const profile = screen.getByRole("tab", { name: "Profil" });
    expect(profile).toHaveFocus();
    expect(profile).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Profilinhalt");
  });

  it("keeps selection stable in manual activation mode until click", () => {
    render(<Fixture activationMode="manual" />);
    const card = screen.getByRole("tab", { name: "Karte" });
    const profile = screen.getByRole("tab", { name: "Profil" });
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(profile).toHaveFocus();
    expect(card).toHaveAttribute("aria-selected", "true");
    expect(card).toHaveAttribute("tabindex", "-1");
    expect(profile).toHaveAttribute("tabindex", "0");
    fireEvent.click(profile);
    expect(profile).toHaveAttribute("aria-selected", "true");
  });
});
