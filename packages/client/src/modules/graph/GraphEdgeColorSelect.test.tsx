import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphEdgeColorSelect } from "./GraphEdgeColorSelect";

afterEach(cleanup);

const optionLabels = {
  auto: "Automatic (by direction)",
  ink: "Ink",
  gold: "Gold",
  rose: "Rose",
  moss: "Moss",
  blue: "Blue",
} as const;

describe("GraphEdgeColorSelect", () => {
  it("exposes every named color through the shared listbox", () => {
    const onChange = vi.fn();
    render(
      <GraphEdgeColorSelect
        label="Edge color"
        value="auto"
        optionLabels={optionLabels}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Edge color" });
    expect(trigger).toHaveTextContent("Automatic (by direction)");
    expect(trigger.querySelector('[data-edge-color="auto"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Edge color" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(6);
    const rose = within(listbox).getByRole("option", { name: "Rose" });
    expect(rose.querySelector('[data-edge-color="rose"]')).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(rose);

    expect(onChange).toHaveBeenCalledWith("rose");
  });

  it("stays compact without imposing a minimum width on mobile inspectors", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/GraphEdgeAppearanceSelect.css"),
      "utf8",
    );
    const colorCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/GraphEdgeColorSelect.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.graph-edge-appearance-select\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);[^}]*background:\s*var\(--chrome\);/s,
    );
    expect(css).toMatch(
      /\.graph-edge-appearance-select__control\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(colorCss).toMatch(
      /\.graph-edge-color-swatch\[data-edge-color="auto"\]\s*\{[^}]*var\(--graph-edge-directed-stroke\)[^}]*var\(--graph-edge-undirected-stroke\)/s,
    );
  });
});
