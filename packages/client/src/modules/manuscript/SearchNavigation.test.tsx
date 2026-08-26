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
