import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChapterTimelineEntry,
  ChapterTimelinePage,
  SnapshotChapterRecord,
} from "../../platform";
import type { VersionDiffProjection } from "../history";

const history = vi.hoisted(() => ({ chapterTimeline: vi.fn() }));

vi.mock("../../platform", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../platform")>();
  const client = original.quiltorClient;
  return {
    ...original,
    quiltorClient: { ...client, application: { ...client.application, history } },
  };
});

import { I18nProvider } from "../../i18n";
import { ChapterHistoryPanel, type ChapterHistoryPanelProps } from "./ChapterHistoryPanel";

const record = (text: string): SnapshotChapterRecord => ({
  available: true,
  exists: true,
  text,
  marks: [],
});

function entry(
  digit: string,
  subject: string,
  change: ChapterTimelineEntry["change"],
): ChapterTimelineEntry {
  return {
    hash: digit.repeat(64),
    shortHash: digit.repeat(8),
    date: "2026-11-07T18:16:00",
    subject,
    kind: "manual",
    change,
  };
}

const edited = entry("3", "Gekürzt", "edited");
const unknown = entry("2", "Vom anderen Gerät", "unknown");
const created = entry("1", "Erster Entwurf", "created");

function page(
  entries: ChapterTimelineEntry[],
  next: string | null,
  skipped = 0,
): ChapterTimelinePage {
  return { entries, skipped, next };
}

function renderPanel(overrides: Partial<ChapterHistoryPanelProps> = {}) {
  const props: ChapterHistoryPanelProps = {
    chapterId: "x-chronicle",
    commits: [],
    selectedRef: "",
    selected: null,
    previous: null,
    projection: null,
    state: "idle",
    onClose: vi.fn(),
    onRefChange: vi.fn(),
    ...overrides,
  };
  const view = render(
    <I18nProvider>
      <ChapterHistoryPanel {...props} />
    </I18nProvider>,
  );
  return { ...view, props };
}

async function openTimeline() {
  fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => history.chapterTimeline.mockReset());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChapterHistoryPanel timeline", () => {
  it("asks for nothing until the timeline is chosen", () => {
    renderPanel();
    expect(history.chapterTimeline).not.toHaveBeenCalled();
  });

  it("lists the versions that changed the chapter, with what they did and what was skipped", async () => {
    history.chapterTimeline.mockResolvedValue(page([edited, unknown, created], null, 1));
    const { props } = renderPanel();
    await openTimeline();

    const list = within(
      screen.getByRole("region", { name: "Versionen, die dieses Kapitel geändert haben" }),
    );
    const rows = list.getAllByRole("button");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAccessibleName(/Gekürzt.*Kapitel geändert/);
    expect(rows[1]).toHaveAccessibleName(/Änderung nicht feststellbar/);
    expect(rows[2]).toHaveAccessibleName(/Kapitel angelegt/);
    expect(screen.getByText("1 Version ohne Änderung an diesem Kapitel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ältere Versionen laden" })).toBeNull();

    // A version whose change cannot be determined can still be chosen.
    fireEvent.click(rows[1] as HTMLElement);
    expect(props.onRefChange).toHaveBeenCalledWith(unknown.hash);
  });

  it("counts the words of the chosen version from its comparison", async () => {
    history.chapterTimeline.mockResolvedValue(page([edited, created], null));
    const projection: VersionDiffProjection = {
      changes: [
        { kind: "added", from: 0, to: 9, text: "zwei neue" },
        { kind: "removed", at: 0, text: "drei alte Worte" },
      ],
      equalSpans: [],
      formattingChanges: [],
    };
    renderPanel({
      selectedRef: edited.hash,
      selected: record("zwei neue"),
      previous: record("drei alte Worte"),
      projection,
    });
    await openTimeline();

    expect(screen.getByRole("button", { name: /Gekürzt/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("+2 / −3 Wörter")).toBeInTheDocument();
  });

  it("keeps a version picked beyond the log as the single view's choice", async () => {
    history.chapterTimeline.mockResolvedValue(page([edited, created], null));
    const commits = [edited];
    const { props, rerender } = renderPanel({ commits, selectedRef: edited.hash });
    await openTimeline();

    fireEvent.click(screen.getByRole("button", { name: /Erster Entwurf/ }));
    expect(props.onRefChange).toHaveBeenCalledWith(created.hash);
    rerender(
      <I18nProvider>
        <ChapterHistoryPanel {...props} selectedRef={created.hash} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Eine Version" }));

    const select = screen.getByRole("combobox", { name: "Version" }) as HTMLSelectElement;
    expect(select.value).toBe(created.hash);
    expect(within(select).getAllByRole("option")).toHaveLength(2);
  });

  it("loads older versions through next", async () => {
    history.chapterTimeline
      .mockResolvedValueOnce(page([edited], edited.hash))
      .mockResolvedValueOnce(page([created], null));
    renderPanel();
    await openTimeline();

    fireEvent.click(screen.getByRole("button", { name: "Ältere Versionen laden" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(history.chapterTimeline).toHaveBeenLastCalledWith(
      "x-chronicle",
      expect.objectContaining({ before: edited.hash }),
    );
    expect(screen.getAllByRole("button", { name: /Kapitel (geändert|angelegt)/ })).toHaveLength(2);
  });

  it("says so when no version changed the chapter", async () => {
    history.chapterTimeline.mockResolvedValue(page([], null, 2));
    renderPanel();
    await openTimeline();

    expect(
      screen.getByText("Keine Version hat dieses Kapitel bisher geändert."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 Versionen ohne Änderung an diesem Kapitel")).toBeInTheDocument();
  });

  it("does not claim an empty history while older versions can still be loaded", async () => {
    history.chapterTimeline.mockResolvedValue(page([], created.hash, 20));
    renderPanel();
    await openTimeline();

    expect(screen.queryByText("Keine Version hat dieses Kapitel bisher geändert.")).toBeNull();
    expect(screen.getByText("20 Versionen ohne Änderung an diesem Kapitel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ältere Versionen laden" })).toBeInTheDocument();
  });

  it("reports a failed load and tries again", async () => {
    history.chapterTimeline
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([created], null));
    renderPanel();
    await openTimeline();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Die Timeline konnte nicht geladen werden.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /Kapitel angelegt/ })).toBeInTheDocument();
  });
});
