import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

afterEach(cleanup);

describe("Storyboard workspace navigation", () => {
  it("exposes Storyboard as the fifth primary, keyboard-reachable workspace", () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <WorkspaceSwitcher value="storyboard" onChange={onChange} />
      </I18nProvider>,
    );

    const navigation = screen.getByRole("navigation", { name: "Arbeitsbereich" });
    const buttons = within(navigation).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Text",
      "Figuren",
      "Timeline",
      "Orte",
      "Storyboard",
    ]);

    const storyboard = screen.getByRole("button", { name: "Storyboard" });
    expect(storyboard).toHaveAttribute("aria-current", "page");
    expect(storyboard).not.toHaveAttribute("aria-hidden", "true");
    expect(storyboard).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(onChange).toHaveBeenCalledWith("text");
  });

  it("keeps all five workspaces in the compact horizontal navigation contract", () => {
    render(
      <I18nProvider>
        <WorkspaceSwitcher value="text" onChange={vi.fn()} />
      </I18nProvider>,
    );

    const navigation = screen.getByRole("navigation", { name: "Arbeitsbereich" });
    expect(navigation).toHaveAttribute("data-axis", "x");
    expect(navigation).toHaveAttribute("data-overscroll", "contain");
    expect(navigation).toHaveAttribute("data-scrollbar", "hidden");
    expect(within(navigation).getAllByRole("button")).toHaveLength(5);
  });
});
