import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { PlaceMeasurementOverlay } from "./PlaceMeasurementOverlay";

afterEach(cleanup);

describe("measurement bar", () => {
  it("keeps the scale label for screen readers only", () => {
    render(
      <I18nProvider>
        <PlaceMeasurementOverlay
          measureSelection={["a"]}
          scale={{ unitsPer100px: 25, unitLabel: "km" }}
          onScale={vi.fn()}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );
    const field = screen.getByRole("spinbutton", { name: "Maßstab" });
    const label = document.querySelector(`label[for="${field.id}"]`);
    expect(label).toHaveClass("sr-only");
    expect(screen.getByText("pro 100px")).toBeVisible();
  });
});

describe("measuring hint", () => {
  it("informs in the info tone, not the warning tone of an error", () => {
    render(
      <I18nProvider>
        <PlaceMeasurementOverlay
          measureSelection={[]}
          scale={{ unitsPer100px: 25, unitLabel: "km" }}
          onScale={vi.fn()}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveClass("mode-banner--info");
  });

  it("stacks the level trail above the hint, inside the same column", () => {
    render(
      <I18nProvider>
        <PlaceMeasurementOverlay
          measureSelection={[]}
          scale={undefined}
          onScale={vi.fn()}
          onStop={vi.fn()}
          trail={<nav data-testid="trail" />}
        />
      </I18nProvider>,
    );
    const column = document.querySelector(".places-measure-overlays");
    expect(column?.firstElementChild).toBe(screen.getByTestId("trail"));
  });
});
