import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { Manuscript } from "../../manuscript";
import type { FigureState } from "../model";
import {
  chaptersUsingTimelineMoment,
  firstReversedChapterTimeRange,
  TimelineWorkspace,
} from "./TimelineWorkspace";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";

afterEach(cleanup);

const state: FigureState = {
  timeline: [{ id: "m1", title: "Ankunft" }],
  nodes: [
    { id: "ada", x: 0, y: 0, name: "Ada", type: "person" },
    { id: "hafen", x: 0, y: 0, name: "Hafen", type: "ort" },
  ],
  edges: [],
};
const emptyManuscript: Manuscript = { chapters: [] };

function renderTimeline(
  onChange = vi.fn(),
  value = state,
  manuscript: Manuscript = emptyManuscript,
  onOpenChapter?: (chapterId: string) => void,
) {
  return {
    ...render(
      <I18nProvider>
        <TimelineWorkspace
          state={value}
          onChange={onChange}
          manuscript={manuscript}
          onOpenChapter={onOpenChapter}
        />
      </I18nProvider>,
    ),
    onChange,
  };
}

describe("TimelineWorkspace sections", () => {
  it("delegates the horizontal moment rail to the public ScrollArea contract", () => {
    renderTimeline();
    const rail = screen.getByRole("navigation", { name: "Timeline" });
    expect(rail).toHaveClass("scroll-area", "story-timeline");
    expect(rail).toHaveAttribute("data-axis", "x");
    expect(rail).toHaveAttribute("data-gutter", "stable");
    expect(rail).toHaveAttribute("data-scrollbar", "thin");
    expect(rail).toHaveAttribute("data-surface", "panel");

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/timeline/MomentBoard.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.story-timeline\s*\{[^}]*padding:\s*var\(--space-14\) var\(--space-18\) var\(--space-12\);[^}]*border-bottom:\s*1px solid var\(--line\);/s,
    );
    expect(css).not.toMatch(/\.story-timeline(?:\s*\{|::)[^}]*(?:overflow|scrollbar)/s);
    expect(css).not.toContain(".story-timeline::-webkit-scrollbar");
  });

  it("keeps the 390px toolbar, forms, and state inspector inside the viewport", () => {
    const root = join(process.cwd(), "packages/client/src/modules/story-world/timeline");
    const workspaceCss = readFileSync(join(root, "TimelineWorkspace.css"), "utf8");
    const controlsCss = readFileSync(join(root, "TimeSystemControls.css"), "utf8");
    const fieldsCss = readFileSync(join(root, "MomentTimeFields.css"), "utf8");
    const panelsCss = readFileSync(join(root, "StateChangePanels.css"), "utf8");

    expect(workspaceCss).toMatch(
      /\.timeline-workspace\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(workspaceCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.timeline-workspace \.timeline-toolbar-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    );
    expect(controlsCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.timeline-time-controls\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--control-touch\);/s,
    );
    expect(fieldsCss).toMatch(
      /\.calendar-coordinate-control\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(panelsCss).toMatch(
      /\.storyboard-inspector-sheet \.storyboard-inspector\s*\{[^}]*position:\s*static;[^}]*width:\s*100%;/s,
    );
    expect(panelsCss).not.toContain(".ui-sheet .storyboard-inspector");
  });

  it("leaves touch sizing of segmented and inspector actions with the design controls", () => {
    const headerCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/timeline/MomentHeader.css"),
      "utf8",
    );
    const panelsCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/timeline/StateChangePanels.css"),
      "utf8",
    );
    const tokensCss = readFileSync(
      join(process.cwd(), "packages/client/src/design/tokens.css"),
      "utf8",
    );
    const modeRule = panelsCss.match(/\.storyboard-mode \[role="radio"\]\s*\{([^}]*)\}/s)?.[1];
    const inspectorActionRule = panelsCss.match(
      /\.relationship-inspector-action,\s*\.reset-inheritance\s*\{([^}]*)\}/s,
    )?.[1];

    expect(modeRule).toBeDefined();
    expect(modeRule).not.toMatch(/\b(?:min-)?height\s*:/);
    expect(inspectorActionRule).toBeDefined();
    expect(inspectorActionRule).not.toMatch(/\b(?:min-)?height\s*:/);
    expect(
      headerCss.match(
        /\.storyboard-stepper-action,\s*\.storyboard-actions-trigger\s*\{([^}]*)\}/s,
      )?.[1],
    ).not.toMatch(/\b(?:min-)?height\s*:/);
    expect(headerCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.storyboard-actions-trigger\s*\{[^}]*min-width:\s*var\(--control-touch\);/s,
    );
    expect(tokensCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?--control-regular:\s*var\(--control-touch\);/,
    );
  });

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

  it("reselects a repeated navigation target after an internal selection", () => {
    const navigationState: FigureState = {
      ...state,
      timeline: [
        { id: "m1", title: "Ankunft", time: 0, position: 0 },
        { id: "m2", title: "Abreise", time: 1, position: 1 },
      ],
    };
    const view = render(
      <I18nProvider>
        <TimelineWorkspace
          state={navigationState}
          onChange={vi.fn()}
          manuscript={emptyManuscript}
          targetId="m1"
          targetRequestId={1}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ankunft");
    fireEvent.click(screen.getByRole("button", { name: /Abreise/ }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Abreise");

    view.rerender(
      <I18nProvider>
        <TimelineWorkspace
          state={{
            ...navigationState,
            timeline: navigationState.timeline?.map((moment) =>
              moment.id === "m2" ? { ...moment, title: "Abreise bearbeitet" } : moment,
            ),
          }}
          onChange={vi.fn()}
          manuscript={emptyManuscript}
          targetId="m1"
          targetRequestId={1}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Abreise bearbeitet");

    view.rerender(
      <I18nProvider>
        <TimelineWorkspace
          state={navigationState}
          onChange={vi.fn()}
          manuscript={emptyManuscript}
          targetId="m1"
          targetRequestId={2}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ankunft");
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

  it("switches projection from the designed listbox without changing canonical moments", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, timedState);
    const control = screen.getByRole("combobox", { name: "Zeitsystem" });
    expect(control.tagName).toBe("BUTTON");
    fireEvent.click(control);
    fireEvent.click(screen.getByRole("option", { name: "Gregorianisch" }));
    const next = onChange.mock.calls[0][0] as FigureState;
    expect(next.timeSystem?.kind).toBe("gregorian");
    expect(next.timeSystem?.displayFormat).toBe("{day:02d}.{month:02d}.{year:04d} {era}");
    expect(next.timeline).toEqual(timedState.timeline);
  });

  it("keeps creation simple and edits relative placement inside the selected moment", () => {
    const onChange = vi.fn();
    renderTimeline(onChange, timedState);
    const addCalendar = screen.getByRole("button", { name: "Kalender hinzufügen" });
    expect(addCalendar).toHaveClass("ui-toolbar-button", "ui-button--primary");
    expect(addCalendar).toHaveAttribute("data-workspace-action", "create");
    expect(screen.queryByRole("spinbutton", { name: "Abstand in Tagen" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Abstand" })).not.toBeInTheDocument();
    const addButtons = screen.getAllByRole("button", { name: "Zeitpunkt hinzufügen" });
    expect(addButtons).toHaveLength(1);
    expect(addButtons[0]).toHaveAttribute("data-workspace-action", "create");
    expect(addCalendar.closest(".workspace-toolbar__group")).toBe(
      addButtons[0].closest(".workspace-toolbar__group"),
    );

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
    expect(screen.getByRole("dialog", { name: "Zeitsystem konfigurieren" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Zeitsystem konfigurieren" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    view.rerender(
      <I18nProvider>
        <TimelineWorkspace state={next} onChange={onChange} manuscript={emptyManuscript} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Kalender hinzufügen" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Zeitsystem konfigurieren" })).toBeVisible();
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
    fireEvent.click(screen.getByRole("button", { name: "Zeitsystem konfigurieren" }));
    expect(screen.getByRole("combobox", { name: "Reihenfolge des Datums" })).toHaveValue(
      "{day:02d}.{month:02d}.{year:04d} {era}",
    );
    const startDate = screen.getByRole("group", { name: "Datum" });
    expect(
      [...startDate.querySelectorAll(":scope > .calendar-coordinate-field > label")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["Tag", "Monat", "Jahr"]);
    const anchorDate = document.querySelector(".timeline-anchor-date");
    expect(anchorDate).not.toBeNull();
    if (!anchorDate) throw new Error("Expected the calendar anchor fields to render");
    expect(
      [...anchorDate.querySelectorAll(":scope > .calendar-coordinate-field > label")].map(
        (label) => label.textContent,
      ),
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
    const monthPrecisionState = onChange.mock.calls.at(-1)?.[0] as FigureState | undefined;
    expect(monthPrecisionState?.timeline?.find((m) => m.id === "m1")).toMatchObject({
      precision: "month",
      time: 0,
    });

    fireEvent.change(within(date).getByRole("combobox", { name: "Monat" }), {
      target: { value: "" },
    });
    const yearPrecisionState = onChange.mock.calls.at(-1)?.[0] as FigureState | undefined;
    expect(yearPrecisionState?.timeline?.find((m) => m.id === "m1")).toMatchObject({
      precision: "year",
      time: 0,
    });
  });
});

describe("TimelineWorkspace chapter story-time integrity", () => {
  const anchoredTimeline: FigureState = {
    ...state,
    timeline: [
      { id: "start", title: "Beginn", time: 0, position: 0 },
      { id: "end", title: "Ende", time: 10, position: 1 },
    ],
  };
  const manuscript: Manuscript = {
    chapters: [
      {
        id: "range",
        title: "Zeitraum",
        body: "",
        note: "",
        storyTime: { startMomentId: "start", endMomentId: "end" },
      },
      {
        id: "point",
        title: "Rückblende",
        body: "",
        note: "",
        storyTime: { startMomentId: "start" },
      },
    ],
  };

  it("collects every chapter that references a moment, regardless of anchor side", () => {
    expect(chaptersUsingTimelineMoment(manuscript, "start")).toEqual([
      { id: "range", title: "Zeitraum" },
      { id: "point", title: "Rückblende" },
    ]);
    expect(chaptersUsingTimelineMoment(manuscript, "end")).toEqual([
      { id: "range", title: "Zeitraum" },
    ]);
  });

  it("uses time and incoming order instead of stale position fields for range validity", () => {
    const rangeOnly: Manuscript = { chapters: [manuscript.chapters[0]] };
    expect(
      firstReversedChapterTimeRange(rangeOnly, [
        { id: "start", title: "Beginn", time: 5, position: 99 },
        { id: "end", title: "Ende", time: 5, position: -12 },
      ]),
    ).toBeNull();
    expect(
      firstReversedChapterTimeRange(rangeOnly, [
        { id: "end", title: "Ende", time: 5, position: 99 },
        { id: "start", title: "Beginn", time: 5, position: -12 },
      ]),
    ).toEqual({ id: "range", title: "Zeitraum" });
  });

  it("explains protected moments, disables deletion, and opens the first affected chapter", () => {
    const onChange = vi.fn();
    const onOpenChapter = vi.fn();
    renderTimeline(onChange, anchoredTimeline, manuscript, onOpenChapter);

    expect(
      screen.getByText(
        "Dieser Zeitpunkt wird von 2 Kapiteln verwendet („Zeitraum“, „Rückblende“) und kann deshalb nicht gelöscht werden.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Kapitel „Zeitraum“ öffnen" }));
    expect(onOpenChapter).toHaveBeenCalledWith("range");

    fireEvent.click(screen.getByRole("button", { name: "Aktionen" }));
    const deleteAction = screen.getByRole("menuitem", { name: "Löschen" });
    expect(deleteAction).toBeDisabled();
    fireEvent.click(deleteAction);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Zeitpunkt löschen" })).not.toBeInTheDocument();
  });

  it("uses the translated untitled fallback for referenced chapters without a title", () => {
    renderTimeline(vi.fn(), anchoredTimeline, {
      chapters: [{ ...manuscript.chapters[0], title: "" }],
    });

    expect(
      screen.getByText(
        "Dieser Zeitpunkt wird von Kapitel „Ohne Titel“ verwendet und kann deshalb nicht gelöscht werden.",
      ),
    ).toBeVisible();
  });

  it("rejects a move that would reverse a stored chapter range and explains the conflict", () => {
    const onChange = vi.fn();
    const onOpenChapter = vi.fn();
    renderTimeline(onChange, anchoredTimeline, manuscript, onOpenChapter);

    fireEvent.click(screen.getByRole("button", { name: "Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Später" }));

    expect(onChange).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Kapitelzeitraum bleibt gültig");
    expect(alert).toHaveTextContent(
      "Diese Änderung würde den Beginn hinter das Ende des Zeitraums von Kapitel „Zeitraum“ verschieben. Sie wurde nicht übernommen.",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Kapitel „Zeitraum“ öffnen" }));
    expect(onOpenChapter).toHaveBeenCalledWith("range");
  });
});
