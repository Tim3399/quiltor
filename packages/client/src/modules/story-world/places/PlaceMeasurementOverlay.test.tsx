import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("level scale field", () => {
  it("writes only a positive scale, including one below 0.01", () => {
    const onScale = vi.fn();
    render(
      <I18nProvider>
        <PlaceMeasurementOverlay
          measureSelection={[]}
          scale={{ unitsPer100px: 25, unitLabel: "km" }}
          onScale={onScale}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );
    const field = screen.getByRole("spinbutton", { name: "Maßstab" });
    for (const value of ["0", "-12", ""]) fireEvent.change(field, { target: { value } });
    expect(onScale).not.toHaveBeenCalled();
    // The draft stays as typed instead of jumping back to the stored scale.
    expect(field).toHaveValue(null);
    fireEvent.change(field, { target: { value: "0.0667" } });
    expect(onScale).toHaveBeenLastCalledWith({ unitsPer100px: 0.0667 });
  });

  it("offers measuring the level's scale on the map", () => {
    const onCalibrate = vi.fn();
    render(
      <I18nProvider>
        <PlaceMeasurementOverlay
          measureSelection={[]}
          scale={undefined}
          onScale={vi.fn()}
          onStop={vi.fn()}
          onCalibrate={onCalibrate}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Auf der Karte messen" }));
    expect(onCalibrate).toHaveBeenCalledOnce();
  });
});
