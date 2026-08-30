import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ChapterHistoryPanel } from "./ChapterHistoryPanel";

describe("ChapterHistoryPanel", () => {
  it("renders version choices and reports a changed ref", () => {
    const onRefChange = vi.fn();
    render(
      <I18nProvider>
        <ChapterHistoryPanel
          commits={[{ hash: "abc", shortHash: "abc", date: "2026-01-01", subject: "Version" }]}
          selectedRef="abc"
          historicalText="Früherer Text"
          historicalExists
          previousHistoricalText=""
          comparisonAvailable
          state="idle"
          onClose={() => undefined}
          onRefChange={onRefChange}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Früherer Text")).toBeInTheDocument();
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
          historicalText=""
          historicalExists={false}
          previousHistoricalText=""
          comparisonAvailable
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

  it("marks additions and removals against the directly preceding version semantically", () => {
    const { container } = render(
      <I18nProvider>
        <ChapterHistoryPanel
          commits={[{ hash: "new", shortHash: "new", date: "2026-01-02", subject: "Neu" }]}
          selectedRef="new"
          historicalText="Der junge Baum."
          historicalExists
          previousHistoricalText="Der alte Baum."
          comparisonAvailable
          state="idle"
          onClose={() => undefined}
          onRefChange={() => undefined}
        />
      </I18nProvider>,
    );

    expect(container.querySelector("ins")).toHaveTextContent("junge");
    expect(container.querySelector("del")).toHaveTextContent("alte");
    const rendered = within(container);
    expect(rendered.getByText("Hinzugefügt")).toBeVisible();
    expect(rendered.getByText("Entfernt")).toBeVisible();
    expect(rendered.getByLabelText("Änderungen dieser Fassung")).toBeInTheDocument();
  });

  it("shows the selected text without false additions when its parent is unavailable", () => {
    const { container } = render(
      <I18nProvider>
        <ChapterHistoryPanel
          commits={[{ hash: "new", shortHash: "new", date: "2026-01-02", subject: "Neu" }]}
          selectedRef="new"
          historicalText="Nur die ausgewählte Fassung."
          historicalExists
          previousHistoricalText=""
          comparisonAvailable={false}
          state="idle"
          onClose={() => undefined}
          onRefChange={() => undefined}
        />
      </I18nProvider>,
    );

    expect(within(container).getByRole("status")).toHaveTextContent("nicht verfügbar");
    expect(container.querySelector("ins, del")).toBeNull();
    expect(container).toHaveTextContent("Nur die ausgewählte Fassung.");
  });

  it("distinguishes an existing empty chapter from a chapter that did not exist", () => {
    const props = {
      commits: [{ hash: "new", shortHash: "new", date: "2026-01-02", subject: "Neu" }],
      selectedRef: "new",
      historicalText: "",
      previousHistoricalText: "",
      comparisonAvailable: true,
      state: "idle" as const,
      onClose: () => undefined,
      onRefChange: () => undefined,
    };
    const existing = render(
      <I18nProvider>
        <ChapterHistoryPanel {...props} historicalExists />
      </I18nProvider>,
    );
    expect(
      within(existing.container).getByText("Das Kapitel ist in dieser Fassung leer."),
    ).toBeVisible();
    existing.unmount();

    const missing = render(
      <I18nProvider>
        <ChapterHistoryPanel {...props} historicalExists={false} />
      </I18nProvider>,
    );
    expect(
      within(missing.container).getByText(
        "Dieses Kapitel existierte in dieser Fassung noch nicht.",
      ),
    ).toBeVisible();
  });
});
