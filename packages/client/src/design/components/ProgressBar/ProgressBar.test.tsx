import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

afterEach(cleanup);

describe("ProgressBar", () => {
  it("clamps determinate values and exposes the numeric range", () => {
    render(<ProgressBar label="Installation" value={120} max={100} showValue />);
    const progress = screen.getByRole("progressbar", { name: "Installation" });
    expect(progress).toHaveAttribute("aria-valuenow", "100");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("omits numeric aria values while indeterminate", () => {
    render(<ProgressBar label="Wird verarbeitet" />);
    const progress = screen.getByRole("progressbar", { name: "Wird verarbeitet" });
    expect(progress).toHaveAttribute("data-indeterminate", "true");
    expect(progress).not.toHaveAttribute("aria-valuenow");
  });
});
