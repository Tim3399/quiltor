import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphEdgeInspector, type GraphEdgeInspectorLabels } from "./GraphEdgeInspector";

afterEach(cleanup);

const labels: GraphEdgeInspectorLabels = {
  title: "Relationship",
  label: "Name relationship",
  labelPlaceholder: "Name this edge",
  directed: "Directed",
  reverse: "Reverse direction",
  conflict: "This edge already exists.",
  lineStyle: "Line style",
  lineStyleOptions: {
    solid: "Solid",
    dashed: "Dashed",
    dotted: "Dotted",
  },
  color: "Edge color",
  colorOptions: {
    auto: "Automatic (by direction)",
    ink: "Ink",
    gold: "Gold",
    rose: "Rose",
    moss: "Moss",
    blue: "Blue",
  },
};

function renderInspector(overrides: Partial<ComponentProps<typeof GraphEdgeInspector>> = {}) {
  const callbacks = {
    onLabelChange: vi.fn(),
    onDirectedChange: vi.fn(),
    onLineStyleChange: vi.fn(),
    onColorChange: vi.fn(),
    onReverse: vi.fn(),
  };
  render(
    <GraphEdgeInspector
      sourceLabel="Ada"
      targetLabel="Bela"
      value="Friends"
      directed={false}
      lineStyle="solid"
      color="auto"
      labels={labels}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe("GraphEdgeInspector", () => {
  it("edits the shared label and direction language", () => {
    const callbacks = renderInspector();

    expect(screen.getByRole("region", { name: "Relationship" })).toHaveTextContent("Ada ↔ Bela");
    expect(screen.getByRole("region", { name: "Relationship" })).toHaveAttribute(
      "data-scrollbar",
      "thin",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Name relationship" }), {
      target: { value: "Rivals" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Directed" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Line style" }));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Line style" })).getByText("Dotted"),
    );

    expect(callbacks.onLabelChange).toHaveBeenCalledWith("Rivals");
    expect(callbacks.onDirectedChange).toHaveBeenCalledWith(true);
    expect(callbacks.onLineStyleChange).toHaveBeenCalledWith("dotted");
    expect(screen.queryByRole("button", { name: "Reverse direction" })).not.toBeInTheDocument();
  });

  it("offers reversal for directed edges and explains conflicts deterministically", () => {
    const callbacks = renderInspector({
      directed: true,
      toggleConflict: true,
      reverseConflict: true,
    });

    expect(screen.getByText("Ada → Bela")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Directed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reverse direction" })).toBeDisabled();
    expect(screen.getAllByText("This edge already exists.")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Reverse direction" }));
    expect(callbacks.onReverse).not.toHaveBeenCalled();
  });

  it("offers a compact shared color listbox with decorative semantic swatches", () => {
    const callbacks = renderInspector();
    const color = screen.getByRole("combobox", { name: "Edge color" });

    expect(color).toHaveTextContent("Automatic (by direction)");
    expect(color.querySelector('[data-edge-color="auto"]')).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(color);

    const listbox = screen.getByRole("listbox", { name: "Edge color" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(6);
    const rose = within(listbox).getByRole("option", { name: "Rose" });
    expect(rose.querySelector('[data-edge-color="rose"]')).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(rose);

    expect(callbacks.onColorChange).toHaveBeenCalledWith("rose");
  });

  it("supports inherited placeholders and a completely disabled temporal state", () => {
    renderInspector({ value: "", labelPlaceholder: "Inherited", disabled: true });

    expect(screen.getByPlaceholderText("Inherited")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Edge color" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Line style" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Directed" })).toBeDisabled();
  });

  it("owns the collision-safe panel boundary supplied by a graph canvas", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/GraphEdgeInspector.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.graph-edge-inspector-panel\s*\{[^}]*bottom:\s*var\(--graph-edge-inspector-safe-bottom, auto\);[^}]*pointer-events:\s*none;/s,
    );
    expect(css).toMatch(
      /\.graph-edge-inspector\s*\{[^}]*max-height:\s*100%;[^}]*pointer-events:\s*auto;/s,
    );
  });
});
