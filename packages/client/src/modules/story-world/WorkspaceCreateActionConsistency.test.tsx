import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../i18n";
import { FigureToolbar } from "./figures/FigureToolbar";
import type { FigureState } from "./model";
import { PlaceToolbar } from "./places/PlaceToolbar";
import { TimelineToolbar } from "./timeline/TimelineToolbar";
import { DEFAULT_TIME_SYSTEM } from "./timeline/timeSystem";

afterEach(cleanup);

function renderWorkspaceToolbar(toolbar: ReactElement) {
  return render(<I18nProvider>{toolbar}</I18nProvider>);
}

function expectSharedCreateContract(container: HTMLElement, expectedCount: number) {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[data-workspace-action="create"]'),
  );

  expect(buttons).toHaveLength(expectedCount);
  for (const button of buttons) {
    expect(button.closest('[role="toolbar"]')).not.toBeNull();
    expect(button).toHaveClass(
      "workspace-toolbar__create-button",
      "ui-toolbar-button",
      "ui-button--primary",
      "ui-button--regular",
    );
    expect(button).toHaveAttribute("data-appearance", "primary");
    expect(button).toHaveAttribute("data-size", "regular");
    expect(button).toHaveAttribute("data-label-mode", "responsive");
    expect(button).toHaveAttribute("data-collapse-at", "compact");
    expect(button).toHaveAccessibleName();
    expect(button.querySelector(".ui-button__icon svg")).not.toBeNull();
  }
}

function TimelineToolbarHarness() {
  const { locale, t } = useI18n();
  return (
    <TimelineToolbar
      system={DEFAULT_TIME_SYSTEM}
      momentCount={0}
      relationshipCount={0}
      onKindChange={vi.fn()}
      onPatchSystem={vi.fn()}
      onAddMoment={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      canUndo={false}
      canRedo={false}
      locale={locale}
      t={t}
    />
  );
}

describe("workspace create-action consistency", () => {
  it("uses the public create-action contract for places", () => {
    const { container } = renderWorkspaceToolbar(
      <PlaceToolbar
        placesCount={0}
        selected={null}
        measuring={false}
        canUndo={false}
        canRedo={false}
        onAdd={vi.fn()}
        onAddMap={vi.fn()}
        onMeasuringToggle={vi.fn()}
        snapToGrid
        onSnapToGridChange={vi.fn()}
        picturesVisible
        onPicturesVisibleChange={vi.fn()}
        boundToGround
        onBoundToGroundChange={vi.fn()}
        hasGround
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expectSharedCreateContract(container, 1);
  });

  it("uses the same public create-action contract for the figure dropdown trigger", () => {
    const state: FigureState = { nodes: [], edges: [] };
    const { container } = renderWorkspaceToolbar(
      <FigureToolbar
        state={state}
        connecting={false}
        snapToGrid={false}
        relationshipsVisible
        timelineOpen={false}
        journeyOverlayOpen={false}
        canUndo={false}
        canRedo={false}
        onAddNode={vi.fn()}
        onConnectingChange={vi.fn()}
        onSnapToGridChange={vi.fn()}
        onAlignAllNodes={vi.fn()}
        onRelationshipsVisibleChange={vi.fn()}
        onTimelineOpenChange={vi.fn()}
        onJourneyOverlayOpenChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expectSharedCreateContract(container, 1);
  });

  it("keeps calendar and moment creation on one shared timeline contract", () => {
    const { container } = renderWorkspaceToolbar(<TimelineToolbarHarness />);

    expectSharedCreateContract(container, 2);

    const actions = container.querySelector(".timeline-toolbar-actions");
    expect(actions).toHaveAttribute("data-layout", "wrap");
    expect(actions).not.toHaveClass("scroll-area");
    expect(actions).not.toHaveAttribute("data-axis");
    const groups = Array.from(
      actions?.querySelectorAll(":scope > .workspace-toolbar__group") ?? [],
    );
    expect(groups.map((group) => group.classList.item(1))).toEqual([
      "timeline-time-group",
      "timeline-create-group",
      "timeline-history-group",
    ]);
    const timelineCreateButtons = Array.from(
      groups[1]?.querySelectorAll<HTMLButtonElement>('[data-workspace-action="create"]') ?? [],
    );
    expect(timelineCreateButtons).toHaveLength(2);
    expect(timelineCreateButtons[0]?.querySelector(".lucide-calendar-plus")).not.toBeNull();
    expect(timelineCreateButtons[1]?.querySelector(".lucide-clock-plus")).not.toBeNull();

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/timeline/TimelineWorkspace.css"),
      "utf8",
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.timeline-workspace \.timeline-toolbar-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    );
    expect(css).toMatch(
      /\.timeline-workspace \.timeline-toolbar-actions > \.timeline-time-group\s*\{[^}]*grid-column:\s*1 \/ -1;/s,
    );
    expect(css).toMatch(
      /\.timeline-workspace \.timeline-history-group\s*\{[^}]*justify-self:\s*end;/s,
    );
  });
});
