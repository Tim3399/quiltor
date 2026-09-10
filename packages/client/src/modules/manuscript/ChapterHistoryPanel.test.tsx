import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { SnapshotChapterRecord } from "../../platform";
import type { VersionDiffProjection } from "../history";
import { ChapterHistoryPanel } from "./ChapterHistoryPanel";

const record = (
  text: string,
  overrides: Partial<SnapshotChapterRecord> = {},
): SnapshotChapterRecord => ({ available: true, exists: true, text, marks: [], ...overrides });

const unchanged: VersionDiffProjection = { changes: [], equalSpans: [], formattingChanges: [] };

describe("ChapterHistoryPanel", () => {
  it("renders version choices without duplicating the selected prose", () => {
    const onRefChange = vi.fn();
    render(
      <I18nProvider>
        <ChapterHistoryPanel
          commits={[{ hash: "abc", shortHash: "abc", date: "2026-01-01", subject: "Version" }]}
          selectedRef="abc"
          selected={record("Früherer Text")}
          previous={record("Noch früher")}
          projection={unchanged}
          state="idle"
          onClose={() => undefined}
          onRefChange={onRefChange}
        />
      </I18nProvider>,
    );

    expect(screen.queryByText("Früherer Text")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Fassung" }), {
      target: { value: "abc" },
    });
    expect(onRefChange).toHaveBeenCalledWith("abc");
  });

  it("announces a failed version load", () => {
    render(
      <I18nProvider>
        <ChapterHistoryPanel
          commits={[]}
          selectedRef=""
          selected={null}
          previous={null}
          projection={null}
          state="error"
          onClose={() => undefined}
          onRefChange={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByText("Noch keine gespeicherte Fassung vorhanden."),
    ).not.toBeInTheDocument();
  });

  it("summarizes text and formatting changes in its legend", () => {
    render(
      <I18nProvider>
        <ChapterHistoryPanel
          commits={[{ hash: "new", shortHash: "new", date: "2026-01-02", subject: "Neu" }]}
          selectedRef="new"
          selected={record("Der junge Baum.")}
          previous={record("Der alte Baum.")}
          projection={{
            changes: [
              { kind: "removed", at: 4, text: "alte" },
              { kind: "added", from: 4, to: 9, text: "junge" },
            ],
            equalSpans: [],
            formattingChanges: [
              { kind: "format-added", markKind: "bold", from: 10, to: 14 },
              { kind: "format-removed", markKind: "italic", from: 0, to: 3 },
            ],
          }}
          state="idle"
          onClose={() => undefined}
          onRefChange={() => undefined}
        />
      </I18nProvider>,
    );

    const legend = screen.getByLabelText("Legende der Fassungsänderungen");
    expect(legend).toHaveTextContent("Hinzugefügt");
    expect(legend).toHaveTextContent("Entfernt");
    expect(legend).toHaveTextContent("Formatierung hinzugefügt");
    expect(legend).toHaveTextContent("Formatierung entfernt");
    expect(screen.queryByText("Der junge Baum.")).not.toBeInTheDocument();
  });

  it("reports an unavailable predecessor without a false change legend", () => {
    const { container } = render(
      <I18nProvider>
        <ChapterHistoryPanel
          commits={[{ hash: "new", shortHash: "new", date: "2026-01-02", subject: "Neu" }]}
          selectedRef="new"
          selected={record("Nur die ausgewählte Fassung.")}
          previous={record("", { available: false, exists: false })}
          projection={null}
          state="idle"
          onClose={() => undefined}
          onRefChange={() => undefined}
        />
      </I18nProvider>,
    );

    expect(within(container).getByRole("status")).toHaveTextContent("nicht verfügbar");
    expect(container.querySelector(".chapter-version-diff__legend")).toBeNull();
    expect(container).not.toHaveTextContent("Nur die ausgewählte Fassung.");
  });

  it("distinguishes an existing empty chapter from a chapter that did not exist", () => {
    const props = {
      commits: [{ hash: "new", shortHash: "new", date: "2026-01-02", subject: "Neu" }],
      selectedRef: "new",
      previous: record(""),
      projection: unchanged,
      state: "idle" as const,
      onClose: () => undefined,
      onRefChange: () => undefined,
    };
    const existing = render(
      <I18nProvider>
        <ChapterHistoryPanel {...props} selected={record("")} />
      </I18nProvider>,
    );
    expect(
      within(existing.container).getByText("Das Kapitel ist in dieser Fassung leer."),
    ).toBeVisible();
    existing.unmount();

    const missing = render(
      <I18nProvider>
        <ChapterHistoryPanel {...props} selected={record("", { exists: false })} />
      </I18nProvider>,
    );
    expect(
      within(missing.container).getByText(
        "Dieses Kapitel existierte in dieser Fassung noch nicht.",
      ),
    ).toBeVisible();
  });
});
