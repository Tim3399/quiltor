import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../language";
import type { FigureState } from "../../types";
import { TimelineWorkspace } from "./TimelineWorkspace";

afterEach(cleanup);

const state: FigureState = {
  timeline: [{ id: "m1", title: "Ankunft" }],
  nodes: [
    { id: "ada", x: 0, y: 0, name: "Ada", type: "person" },
    { id: "hafen", x: 0, y: 0, name: "Hafen", type: "ort" },
  ],
  edges: [],
};

function renderTimeline(onChange = vi.fn()) {
  return {
    ...render(
      <LanguageProvider>
        <TimelineWorkspace state={state} onChange={onChange} />
      </LanguageProvider>,
    ),
    onChange,
  };
}

describe("TimelineWorkspace sections", () => {
  it("starts focused on relationships and keeps secondary tasks collapsed", () => {
    renderTimeline();
    expect(screen.getByRole("button", { name: "Beziehungen" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Anwesenheit" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Lebensereignisse" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Unverändert / kein Ort")).not.toBeInTheDocument();
  });

  it("reveals a secondary task from its section header", () => {
    renderTimeline();
    const presence = screen.getByRole("button", { name: "Anwesenheit" });
    fireEvent.click(presence);
    expect(presence).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Unverändert / kein Ort")).toBeVisible();
  });

  it("duplicates a moment only after an explicit menu action", () => {
    const onChange = vi.fn();
    renderTimeline(onChange);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Zeitpunkt duplizieren" }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].timeline).toHaveLength(2);
    expect(onChange.mock.calls[0][0].timeline[1].title).toBe("Ankunft – Kopie");
  });
});
