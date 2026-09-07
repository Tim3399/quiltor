import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { TimelineMoment, TimeSystem } from "../story-world";
import { ChapterStoryTimeFields, chapterStoryTimeLabel } from "./ChapterStoryTimeFields";
import type { Chapter } from "./model";
import { requireValue } from "./TextWorkspace.testSupport";

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
  return requireValue(
    screen.getByText("Handlungszeit").closest<HTMLDetailsElement>("details"),
    "Story-time details missing",
  );
}

function storyTimeSummary(details: HTMLDetailsElement) {
  return requireValue(
    within(details).getByText("Handlungszeit").closest<HTMLElement>("summary"),
    "Story-time summary missing",
  );
}

function openStoryTimeFields() {
  const details = storyTimeDetails();
  fireEvent.click(storyTimeSummary(details));
  expect(details).toHaveAttribute("open");
  return details;
}

describe("chapter story time fields", () => {
  it("is compact by default and renders editable fields only once opened", () => {
    renderFields(chapter);

    const details = storyTimeDetails();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Handlungszeit offen")).toBeVisible();
    expect(screen.queryByRole("radio", { name: "Offen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("opens the compact summary and shows the full fields", () => {
    renderFields(chapter);

    const details = openStoryTimeFields();

    expect(within(details).getByText(/Ordnet das Kapitel der Weltzeit zu/)).toBeVisible();
    expect(within(details).getByRole("radio", { name: "Offen" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(details).getByRole("radiogroup")).toHaveClass("binder-story-time-mode");

    fireEvent.click(storyTimeSummary(details));
    expect(details).not.toHaveAttribute("open");
    expect(within(details).queryByRole("radio", { name: "Offen" })).not.toBeInTheDocument();
  });

  it("shows an existing assignment in the closed summary row already", () => {
    renderFields({
      ...chapter,
      storyTime: { startMomentId: "earlier", endMomentId: "later" },
    });

    expect(storyTimeDetails()).not.toHaveAttribute("open");
    expect(screen.getByText("Aufbruch · Tag -10 – Heimkehr · Tag 20")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Von" })).not.toBeInTheDocument();
  });

  it("lets chapters be edited once opened and anchors them chronologically", () => {
    const { onChange } = renderFields(chapter);
    openStoryTimeFields();
    expect(screen.getByRole("radio", { name: "Offen" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Zeitpunkt" }));

    expect(onChange).toHaveBeenCalledWith({ startMomentId: "earlier" });
  });

  it("keeps a span's end chronologically valid when its start is moved", () => {
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

    const start = screen.getByRole("combobox", { name: "Von" });
    expect(start).toHaveClass("binder-story-time-select");
    fireEvent.click(start);
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

  it("offers no span when there is only one point in time", () => {
    renderFields(chapter, vi.fn(), [{ id: "only", title: "Einziger Zeitpunkt", time: 0 }]);
    openStoryTimeFields();

    expect(screen.getByRole("radio", { name: "Zeitpunkt" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Zeitraum" })).toBeDisabled();
  });

  it("shows Gregorian chapter times in the order day, month, year", () => {
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

  it("formats chapter boundaries without nested spans", () => {
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
