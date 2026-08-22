import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { TimeSystem, TimelineMoment } from "../story-world";
import { ChapterStoryTimeFields, chapterStoryTimeLabel } from "./ChapterStoryTimeFields";
import type { Chapter } from "./model";

const chapter: Chapter = { id: "chapter", title: "Rückkehr", body: "", note: "" };
const timeline: TimelineMoment[] = [
  { id: "later", title: "Heimkehr", time: 20, position: 1 },
  { id: "earlier", title: "Aufbruch", time: -10, position: 0 },
];

afterEach(cleanup);

function renderFields(value: Chapter, onChange = vi.fn(), moments: TimelineMoment[] = timeline) {
  return {
    onChange,
    ...render(
      <I18nProvider>
        <ChapterStoryTimeFields chapter={value} timeline={moments} onChange={onChange} />
      </I18nProvider>,
    ),
  };
}

function storyTimeDetails() {
  return screen.getByText("Handlungszeit").closest("details") as HTMLDetailsElement;
}

function openStoryTimeFields() {
  const details = storyTimeDetails();
  fireEvent.click(within(details).getByText("Handlungszeit").closest("summary")!);
  expect(details).toHaveAttribute("open");
  return details;
}

describe("chapter story time fields", () => {
  it("ist standardmäßig kompakt und rendert editierbare Felder erst nach dem Öffnen", () => {
    renderFields(chapter);

    const details = storyTimeDetails();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Handlungszeit offen")).toBeVisible();
    expect(screen.queryByRole("radio", { name: "Offen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("öffnet die kompakte Zusammenfassung und zeigt die vollständigen Felder", () => {
    renderFields(chapter);

    const details = openStoryTimeFields();

    expect(within(details).getByText(/Ordnet das Kapitel der Weltzeit zu/)).toBeVisible();
    expect(within(details).getByRole("radio", { name: "Offen" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(within(details).getByText("Handlungszeit").closest("summary")!);
    expect(details).not.toHaveAttribute("open");
    expect(within(details).queryByRole("radio", { name: "Offen" })).not.toBeInTheDocument();
  });

  it("zeigt eine bestehende Belegung bereits in der geschlossenen Summary-Zeile", () => {
    renderFields({
      ...chapter,
      storyTime: { startMomentId: "earlier", endMomentId: "later" },
    });

    expect(storyTimeDetails()).not.toHaveAttribute("open");
    expect(screen.getByText("Aufbruch · Tag -10 – Heimkehr · Tag 20")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Von" })).not.toBeInTheDocument();
  });

  it("lässt Kapitel nach dem Öffnen bearbeiten und verankert sie chronologisch", () => {
    const { onChange } = renderFields(chapter);
    openStoryTimeFields();
    expect(screen.getByRole("radio", { name: "Offen" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Zeitpunkt" }));

    expect(onChange).toHaveBeenCalledWith({ startMomentId: "earlier" });
  });

  it("hält das Ende eines Zeitraums beim Verschieben des Anfangs chronologisch gültig", () => {
    function Stateful() {
      const [value, setValue] = useState<Chapter>({
        ...chapter,
        storyTime: { startMomentId: "earlier", endMomentId: "later" },
      });
      return (
        <I18nProvider>
          <ChapterStoryTimeFields
            chapter={value}
            timeline={timeline}
            onChange={(storyTime) => setValue((current) => ({ ...current, storyTime }))}
          />
        </I18nProvider>
      );
    }
    render(<Stateful />);
    openStoryTimeFields();

    fireEvent.click(screen.getByRole("combobox", { name: "Von" }));
    expect(
      within(screen.getByRole("listbox", { name: "Von" })).getByRole("option", {
        name: /Heimkehr/,
      }),
    ).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Von" })).getByRole("option", {
        name: /Aufbruch/,
      }),
    );

    expect(screen.getByRole("combobox", { name: "Von" })).toHaveTextContent("Aufbruch");
    expect(screen.getByRole("combobox", { name: "Bis" })).toHaveTextContent("Heimkehr");
    fireEvent.click(screen.getByRole("combobox", { name: "Bis" }));
    expect(
      within(screen.getByRole("listbox", { name: "Bis" })).getByRole("option", {
        name: /Aufbruch/,
      }),
    ).toBeDisabled();
  });

  it("bietet bei nur einem Zeitpunkt keinen Zeitraum an", () => {
    renderFields(chapter, vi.fn(), [{ id: "only", title: "Einziger Zeitpunkt", time: 0 }]);
    openStoryTimeFields();

    expect(screen.getByRole("radio", { name: "Zeitpunkt" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Zeitraum" })).toBeDisabled();
  });

  it("zeigt gregorianische Kapitelzeiten in der Reihenfolge Tag, Monat, Jahr", () => {
    const system: TimeSystem = {
      id: "primary",
      name: "Gregorianisch",
      kind: "gregorian",
      unit: "day",
      eraName: "",
      eraAbbreviation: "",
      epochTime: 0,
      epochYear: 2021,
      epochMonth: 1,
      epochDay: 1,
      epochWeekday: 0,
      displayFormat: "{day:02d}.{month:02d}.{year:04d}",
      months: [],
      weekdays: [],
    };
    const label = chapterStoryTimeLabel(
      { ...chapter, storyTime: { startMomentId: "day-two" } },
      [{ id: "day-two", title: "Danach", time: 1, position: 0 }],
      system,
      (key) => key,
    );

    expect(label).toBe("Danach · 02.01.2021");
  });

  it("formatiert Kapitelgrenzen ohne verschachtelte Zeiträume", () => {
    const system: TimeSystem = {
      id: "primary",
      name: "Gregorianisch",
      kind: "gregorian",
      unit: "day",
      eraName: "",
      eraAbbreviation: "",
      epochTime: 0,
      epochYear: 2021,
      epochMonth: 1,
      epochDay: 1,
      epochWeekday: 0,
      displayFormat: "{day:02d}.{month:02d}.{year:04d}",
      months: [],
      weekdays: [],
    };
    const moments: TimelineMoment[] = [
      { id: "start", title: "Reise", time: 0, endTime: 2, position: 0 },
      { id: "end", title: "Ankunft", time: 5, endTime: 7, position: 1 },
    ];

    expect(
      chapterStoryTimeLabel(
        { ...chapter, storyTime: { startMomentId: "start" } },
        moments,
        system,
        (key) => key,
      ),
    ).toBe("Reise · 01.01.2021");
    expect(
      chapterStoryTimeLabel(
        { ...chapter, storyTime: { startMomentId: "start", endMomentId: "end" } },
        moments,
        system,
        (key) => key,
      ),
    ).toBe("Reise · 01.01.2021 – Ankunft · 08.01.2021");
  });
});
