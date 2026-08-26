import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionMenu } from "./SelectionMenu";

afterEach(cleanup);

describe("SelectionMenu", () => {
  it("focuses the first action, renders metadata and closes after selection", async () => {
    const run = vi.fn();
    const close = vi.fn();
    render(
      <SelectionMenu
        anchorRef={createRef()}
        open
        label="Auswahlaktionen"
        onClose={close}
        actions={[
          { id: "copy", label: "Kopieren", shortcut: "⌘C", run },
          { id: "delete", label: "Löschen", separatorBefore: true, tone: "danger", run() {} },
        ]}
      />,
    );
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Kopieren/ })).toHaveFocus());
    expect(screen.getByText("⌘C")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Kopieren/ }));
    expect(run).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
