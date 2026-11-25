import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SearchNavigation } from "./SearchNavigation";

describe("SearchNavigation", () => {
  it("announces the current result and exposes navigation actions", () => {
    const previous = vi.fn();
    render(
      <I18nProvider>
        <SearchNavigation
          query="Hafen"
          current={2}
          total={4}
          onPrevious={previous}
          onNext={() => undefined}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("2");
    expect(screen.getByRole("status")).toHaveTextContent("4");
    fireEvent.click(screen.getByRole("button", { name: "Vorheriger Treffer" }));
    expect(previous).toHaveBeenCalledOnce();
  });
});

describe("SearchNavigation stylesheet", () => {
  // jsdom does not lay anything out, so the pinning is asserted on the rule itself: the bar
  // must be sticky inside the scrolling manuscript, above the text, with a paper behind it.
  const css = readFileSync(
    join(process.cwd(), "packages/client/src/modules/manuscript/EditorSurface.css"),
    "utf8",
  );
  const rule = css.match(/\.text-search-navigation \{([^}]*)\}/)?.[1] ?? "";

  it("pins the search bar to the top of the manuscript", () => {
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*var\(--space-\d+\)/);
    expect(rule).toMatch(/z-index:\s*var\(--z-sticky\)/);
  });

  it("paints an opaque paper under the translucent hint tint", () => {
    expect(rule).toMatch(/var\(--surface-paper\)/);
  });
});
