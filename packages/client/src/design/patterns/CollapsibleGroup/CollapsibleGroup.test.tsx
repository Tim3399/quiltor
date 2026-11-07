import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CollapsibleGroup } from "./CollapsibleGroup";

afterEach(cleanup);

function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <CollapsibleGroup id="kind-ort" title="Ort" count={2} open={open} onOpenChange={setOpen}>
      <ul>
        <li>Hafen</li>
      </ul>
    </CollapsibleGroup>
  );
}

describe("CollapsibleGroup", () => {
  it("exposes the header as a button wired to its content", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Ort/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "kind-ort-content");
    expect(document.getElementById("kind-ort-content")).toContainElement(screen.getByText("Hafen"));
  });

  it("folds and unfolds on click and hides the content from the page", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Ort/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Hafen")).not.toBeVisible();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Hafen")).toBeVisible();
  });

  it("is a native button, so Enter and Space need no handler of their own", () => {
    render(<Harness initiallyOpen={false} />);
    const trigger = screen.getByRole("button", { name: /Ort/ });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
