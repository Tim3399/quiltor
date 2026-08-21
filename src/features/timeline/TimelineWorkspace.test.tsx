import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../language";
import type { FigureState } from "../../types";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";
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
    expect(next.timeSystem?.displayFormat).toBe("{day:02d}.{month:02d}.{year:04d} {era}");
    expect(next.timeline).toEqual(timedState.timeline);
  });

  it("keeps creation simple and edits relative placement inside the selected moment", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, timedState);
    expect(screen.getByRole("button", { name: "Kalender hinzufügen" })).toHaveClass("primary");
    expect(screen.queryByRole("spinbutton", { name: "Abstand in Tagen" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Abstand" })).not.toBeInTheDocument();
    const addButtons = screen.getAllByRole("button", { name: "Zeitpunkt hinzufügen" });
    expect(addButtons).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /^2Ankunft/ }));
    const placement = screen.getByRole("group", { name: "Zeitliche Einordnung" });
    fireEvent.change(within(placement).getByRole("combobox", { name: "Liegt" }), {
      target: { value: "before" },
    });
    fireEvent.change(within(placement).getByRole("spinbutton", { name: "Abstand in Tagen" }), {
      target: { value: "3" },
    });
    fireEvent.change(within(placement).getByRole("combobox", { name: "Bezugspunkt" }), {
      target: { value: "same" },
    });
    const next = onChange.mock.calls.at(-1)?.[0] as FigureState;
    expect(next.timeline?.map(({ id, time }) => ({ id, time }))).toEqual([
      { id: "m1", time: -3 },
      { id: "past", time: -2 },
      { id: "same", time: 0 },
    ]);
  });

  it("keeps calendar creation available and opens configuration immediately", () => {
    const onChange = vi.fn();
    const view = renderTimeline(onChange, timedState);
    const addCalendar = screen.getByRole("button", { name: "Kalender hinzufügen" });

    fireEvent.click(addCalendar);

    const next = onChange.mock.calls[0][0] as FigureState;
    expect(next.timeSystem?.kind).toBe("custom");
    expect(screen.getByText("Zeitsystem konfigurieren").closest("details")).toHaveAttribute("open");

    view.rerender(
      <LanguageProvider>
        <TimelineWorkspace state={next} onChange={onChange} />
      </LanguageProvider>,
    );
    expect(screen.getByRole("button", { name: "Kalender hinzufügen" })).toBeVisible();
    expect(screen.getByText("Zeitsystem konfigurieren").closest("details")).toHaveAttribute("open");
  });

  it("edits calendar dates without exposing the canonical database value", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, {
      ...timedState,
      timeSystem: {
        ...DEFAULT_TIME_SYSTEM,
        name: "Gregorianisch",
        kind: "gregorian",
        epochYear: 2024,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^2Ankunft/ }));
    expect(screen.queryByRole("textbox", { name: /Kanonischer Zeitwert/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Genauigkeit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Standard" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Reihenfolge des Datums" })).toHaveValue(
      "{day:02d}.{month:02d}.{year:04d} {era}",
    );
    const startDate = screen.getByRole("group", { name: "Datum" });
    expect(
      [...startDate.querySelectorAll(":scope > label > span")].map((label) => label.textContent),
    ).toEqual(["Tag", "Monat", "Jahr"]);
    const anchorDate = document.querySelector(".timeline-anchor-date")!;
    expect(
      [...anchorDate.querySelectorAll(":scope > label > span")].map((label) => label.textContent),
    ).toEqual(["Tag", "Monat", "Jahr"]);
    fireEvent.change(within(startDate).getByRole("combobox", { name: "Tag" }), {
      target: { value: "2" },
    });
    const next = onChange.mock.calls[0][0] as FigureState;
    expect(next.timeline?.map(({ id, time, position }) => ({ id, time, position }))).toEqual([
      { id: "past", time: -2, position: 0 },
      { id: "same", time: 0, position: 1 },
      { id: "m1", time: 1, position: 2 },
    ]);
  });

  it("derives date precision from unknown month and day fields", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, {
      ...timedState,
      timeSystem: {
        ...DEFAULT_TIME_SYSTEM,
        name: "Gregorianisch",
        kind: "gregorian",
        epochYear: 2024,
        displayFormat: "{day:02d}.{month:02d}.{year:04d} {era}",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^2Ankunft/ }));
    const date = screen.getByRole("group", { name: "Datum" });
    expect(within(date).queryByRole("combobox", { name: "Genauigkeit" })).not.toBeInTheDocument();

    fireEvent.change(within(date).getByRole("combobox", { name: "Tag" }), {
      target: { value: "" },
    });
    expect(
      (onChange.mock.calls.at(-1)?.[0] as FigureState).timeline?.find((m) => m.id === "m1"),
    ).toMatchObject({ precision: "month", time: 0 });

    fireEvent.change(within(date).getByRole("combobox", { name: "Monat" }), {
      target: { value: "" },
    });
    expect(
      (onChange.mock.calls.at(-1)?.[0] as FigureState).timeline?.find((m) => m.id === "m1"),
    ).toMatchObject({ precision: "year", time: 0 });
  });
});
