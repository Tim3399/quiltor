import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { GraphViewportChrome } from "./GraphViewportChrome";

vi.mock("@xyflow/react", () => ({
  Controls: ({
    children,
    position,
    ...props
  }: {
    children?: ReactNode;
    position?: string;
    "aria-label"?: string;
  }) => (
    <div data-testid="graph-controls" data-position={position} {...props}>
      {children}
    </div>
  ),
  ControlButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  MiniMap: ({ position, ariaLabel }: { position?: string; ariaLabel?: string }) => (
    <div role="img" data-testid="graph-minimap" data-position={position} aria-label={ariaLabel} />
  ),
}));

afterEach(cleanup);

describe("GraphViewportChrome", () => {
  it("keeps the minimap toggle in the control dock while the map is hidden", () => {
    const onMinimapVisibleChange = vi.fn();
    const view = render(
      <I18nProvider>
        <GraphViewportChrome minimapVisible onMinimapVisibleChange={onMinimapVisibleChange} />
      </I18nProvider>,
    );

    const hide = screen.getByRole("button", { name: "Übersichtskarte ausblenden" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    expect(hide.closest("[data-testid='graph-controls']")).toBeInTheDocument();
    expect(screen.getByTestId("graph-controls")).toHaveAttribute("data-position", "bottom-left");
    expect(screen.getByTestId("graph-controls")).toHaveAccessibleName("Kartensteuerung");
    expect(screen.getByTestId("graph-minimap")).toHaveAttribute("data-position", "bottom-right");
    expect(screen.getByTestId("graph-minimap")).toHaveAccessibleName("Übersichtskarte");
    fireEvent.click(hide);
    expect(onMinimapVisibleChange).toHaveBeenCalledWith(false);

    view.rerender(
      <I18nProvider>
        <GraphViewportChrome
          minimapVisible={false}
          onMinimapVisibleChange={onMinimapVisibleChange}
        />
      </I18nProvider>,
    );
    expect(screen.queryByTestId("graph-minimap")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Übersichtskarte einblenden" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("omits both minimap and toggle when a canvas disables minimap support", () => {
    render(
      <I18nProvider>
        <GraphViewportChrome
          minimapProps={false}
          minimapVisible={false}
          onMinimapVisibleChange={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("graph-controls")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("graph-minimap")).not.toBeInTheDocument();
  });
});
