import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBar, StatusBarItem } from "./StatusBar";

afterEach(cleanup);

describe("StatusBar", () => {
  it("names the region and keeps both sides addressable", () => {
    render(
      <StatusBar
        label="Status"
        start={<StatusBarItem>4 Kapitel</StatusBarItem>}
        end={<StatusBarItem tone="success">Gespeichert</StatusBarItem>}
      />,
    );

    const bar = screen.getByRole("contentinfo", { name: "Status" });
    expect(within(bar).getByText("4 Kapitel")).toBeVisible();
    expect(within(bar).getByText("Gespeichert").closest(".status-bar__item")).toHaveAttribute(
      "data-tone",
      "success",
    );
  });

  it("carries no interactive control", () => {
    const { container } = render(
      <StatusBar label="Status" start={<StatusBarItem>4 Kapitel</StatusBarItem>} />,
    );

    expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });

  it("hides a decorative icon from the accessible name", () => {
    render(
      <StatusBar
        label="Status"
        start={<StatusBarItem icon={<svg role="img" aria-label="Buch" />}>4 Kapitel</StatusBarItem>}
      />,
    );

    const bar = screen.getByRole("contentinfo", { name: "Status" });
    expect(within(bar).queryByRole("img")).toBeNull();
    expect(bar).toHaveTextContent("4 Kapitel");
  });
});
