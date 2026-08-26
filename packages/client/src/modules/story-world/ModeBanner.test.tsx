import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link2 } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModeBanner } from "./ModeBanner";

afterEach(cleanup);

describe("ModeBanner", () => {
  it("announces the active mode and exposes a named dismissal", () => {
    const onDismiss = vi.fn();
    render(
      <ModeBanner icon={<Link2 />} dismissLabel="Cancel connection" onDismiss={onDismiss}>
        Choose a target
      </ModeBanner>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Choose a target");
    fireEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
