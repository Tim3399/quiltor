import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphEdgeLineStyleSelect } from "./GraphEdgeLineStyleSelect";

afterEach(cleanup);

describe("GraphEdgeLineStyleSelect", () => {
  it("shows all independent line patterns with a visual preview", () => {
    const onChange = vi.fn();
    render(
      <GraphEdgeLineStyleSelect
        label="Linienart"
        value="solid"
        optionLabels={{
          solid: "Durchgezogen",
          dashed: "Gestrichelt",
          dotted: "Gepunktet",
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Linienart" }));
    const listbox = screen.getByRole("listbox", { name: "Linienart" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    for (const style of ["solid", "dashed", "dotted"] as const) {
      expect(listbox.querySelector(`[data-edge-line-style="${style}"]`)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }

    fireEvent.click(within(listbox).getByRole("option", { name: "Gepunktet" }));
    expect(onChange).toHaveBeenCalledWith("dotted");
  });

  it("previews the same dash rhythm used by rendered edges", () => {
    const selectCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/GraphEdgeLineStyleSelect.css"),
      "utf8",
    );
    const edgeCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/edgePresentation.css"),
      "utf8",
    );

    expect(selectCss).toContain("var(--graph-edge-color-ink) 0 5px");
    expect(selectCss).toContain("var(--transparent) 5px 9px");
    expect(edgeCss).toMatch(/edge-line-dashed[^}]*stroke-dasharray:\s*5 4/s);
    expect(edgeCss).toMatch(/edge-line-dotted[^}]*stroke-dasharray:\s*1 5/s);
  });
});
