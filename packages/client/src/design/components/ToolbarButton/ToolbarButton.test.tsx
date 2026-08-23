import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolbarButton } from "./ToolbarButton";

afterEach(cleanup);

describe("ToolbarButton", () => {
  it("keeps its visible label as the accessible name when it collapses responsively", () => {
    render(<ToolbarButton label="Neues Kapitel" icon={<Plus />} />);

    const button = screen.getByRole("button", { name: "Neues Kapitel" });
    expect(button).toHaveClass("ui-toolbar-button");
    expect(button).toHaveAttribute("data-label-mode", "responsive");
    expect(button).toHaveAttribute("title", "Neues Kapitel");
    expect(button).toHaveTextContent("Neues Kapitel");
  });

  it("supports persistent labels, pressed state, native events and refs", () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <ToolbarButton
        ref={ref}
        label="Kapitel"
        labelMode="always"
        icon={<Plus />}
        aria-pressed="true"
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Kapitel" });
    expect(button).toHaveAttribute("data-label-mode", "always");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("supports a permanently icon-only presentation without losing its name", () => {
    render(<ToolbarButton label="Rückgängig" labelMode="hidden" icon={<Plus />} />);

    const button = screen.getByRole("button", { name: "Rückgängig" });
    expect(button).toHaveAttribute("data-label-mode", "hidden");
    expect(button).toHaveTextContent("Rückgängig");
  });
});
