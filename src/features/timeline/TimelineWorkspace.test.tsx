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

function renderTimeline(onChange = vi.fn(), value = state) {
  return {
    ...render(
      <LanguageProvider>
        <TimelineWorkspace state={value} onChange={onChange} />
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
    expect(onChange.mock.calls[0][0].timeline).toEqual([
      expect.objectContaining({ id: "m1", time: 0, position: 0 }),
      expect.objectContaining({ time: 0, position: 1 }),
    ]);
  });
});

describe("TimelineWorkspace time system", () => {
  const timedState: FigureState = {
    ...state,
    timeline: [
      { id: "past", title: "Früher", time: -2, position: 0 },
      { id: "m1", title: "Ankunft", time: 0, position: 1 },
      { id: "same", title: "Gleichzeitig", time: 0, position: 2 },
    ],
  };

  it("switches projection without changing canonical moments", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, timedState);
    fireEvent.change(screen.getByRole("combobox", { name: "Zeitsystem" }), {
      target: { value: "gregorian" },
    });
    const next = onChange.mock.calls[0][0] as FigureState;
    expect(next.timeSystem?.kind).toBe("gregorian");
    expect(next.timeline).toEqual(timedState.timeline);
  });

  it("creates a moment at basis minus a relative amount without moving existing times", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, timedState);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Abstand" }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Richtung" }), {
      target: { value: "before" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Basiszeitpunkt" }), {
      target: { value: "m1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Relativen Zeitpunkt anlegen" }));
    const next = onChange.mock.calls[0][0] as FigureState;
    expect(next.timeline?.map((moment) => moment.time)).toEqual([-3, -2, 0, 0]);
    expect(timedState.timeline?.map(({ id, time, position }) => ({ id, time, position }))).toEqual([
      { id: "past", time: -2, position: 0 },
      { id: "m1", time: 0, position: 1 },
      { id: "same", time: 0, position: 2 },
    ]);
  });

  it("keeps simultaneous moments independent and reorders only after editing t", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, timedState);
    fireEvent.click(screen.getByRole("button", { name: /^2Ankunft/ }));
    const input = screen.getByRole("textbox", { name: /^Kanonischer Zeitwert \(t\)/ });
    fireEvent.change(input, {
      target: { value: "t+1" },
    });
    fireEvent.blur(input);
    const next = onChange.mock.calls[0][0] as FigureState;
    expect(next.timeline?.map(({ id, time, position }) => ({ id, time, position }))).toEqual([
      { id: "past", time: -2, position: 0 },
      { id: "same", time: 0, position: 1 },
      { id: "m1", time: 1, position: 2 },
    ]);
  });
});
