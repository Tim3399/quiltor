import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextWorkspace } from "./TextWorkspace";
import { figures, manuscript, renderWorkspace, TestProviders } from "./TextWorkspace.testSupport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TextWorkspace while the world's documents load", () => {
  it("mounts no chapter editor before the documents are loaded (a)", () => {
    const onChange = vi.fn();
    const props = { manuscript, figures, onChange, focus: false, onFocus: vi.fn() };
    const view = renderWorkspace({ ...props, documentsReady: false });

    expect(screen.queryByRole("textbox", { name: "Kapiteltext" })).not.toBeInTheDocument();
    const status = screen.getByRole("status", { name: "" });
    expect(status).toHaveTextContent("Kapitel lädt …");
    expect(status).toHaveAttribute("aria-busy", "true");

    view.rerender(
      <TestProviders>
        <TextWorkspace {...props} documentsReady />
      </TestProviders>,
    );
    expect(screen.getByRole("textbox", { name: "Kapiteltext" })).toHaveTextContent("Hallo Welt");
    expect(screen.queryByText("Kapitel lädt …")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
