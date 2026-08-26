import { fireEvent, render, screen } from "@testing-library/react";
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
          state="error"
          onClose={() => undefined}
          onRefChange={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
