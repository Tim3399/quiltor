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
