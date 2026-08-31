import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

describe("WorkspaceSwitcher", () => {
  it("marks the current workspace and reports a new selection", () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <WorkspaceSwitcher value="figures" onChange={onChange} />
      </I18nProvider>,
    );

    const navigation = screen.getByRole("navigation", { name: "Arbeitsbereich" });
    expect(navigation).toHaveClass("scroll-area", "workspace-switch");
    expect(navigation).toHaveAttribute("data-axis", "x");
    expect(navigation).toHaveAttribute("data-gutter", "auto");
    expect(navigation).toHaveAttribute("data-overscroll", "contain");
    expect(navigation).toHaveAttribute("data-scrollbar", "hidden");
    expect(screen.getByRole("button", { name: "Figuren" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("button")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(onChange).toHaveBeenCalledWith("timeline");

    fireEvent.click(screen.getByRole("button", { name: "Storyboard" }));
    expect(onChange).toHaveBeenLastCalledWith("storyboard");
  });

  it("keeps compact layout geometry local without owning scrollbar styling", () => {
    const css = readFileSync(join(process.cwd(), "packages/client/src/app/AppShell.css"), "utf8");

    expect(css).toMatch(
      /@media \(max-width: 719px\)[\s\S]*?\.app-bar \.workspace-switch\s*\{[^}]*flex:\s*1 1 0;[^}]*justify-content:\s*safe center;/s,
    );
    expect(css).not.toMatch(
      /\.app-bar \.workspace-switch\s*\{[^}]*(?:overflow|overscroll|scrollbar)/s,
    );
    expect(css).not.toContain(".workspace-switch::-webkit-scrollbar");
  });
});
