import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { PlaceInspector } from "./PlaceInspector";

afterEach(cleanup);

const state: FigureState = {
  nodes: [
    { id: "p", x: 0, y: 0, name: "Hafen", type: "ort" },
    { id: "q", x: 100, y: 0, name: "Burg", type: "ort" },
    { id: "f", x: 0, y: 0, name: "Ada", type: "person" },
  ],
  edges: [],
  timeline: [{ id: "later", title: "Später" }],
  presence: [
    { id: "presence-base", elementId: "f", placeId: "p" },
    { id: "presence-later", elementId: "f", placeId: "q", momentId: "later" },
  ],
};

describe("PlaceInspector", () => {
  it("owns favorite/lock editing and cross-workspace history links", () => {
    const onPatch = vi.fn();
    const onOpen = vi.fn();
    render(
      <I18nProvider>
        <PlaceInspector
          selected={state.nodes[0]}
          state={state}
          onPatch={onPatch}
          onClose={vi.fn()}
          onOpen={onOpen}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ort favorisieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Position fixieren" }));
    expect(onPatch).toHaveBeenNthCalledWith(1, { important: true });
    expect(onPatch).toHaveBeenNthCalledWith(2, { pinned: true });

    fireEvent.click(screen.getAllByRole("button", { name: "Ada" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(onOpen).toHaveBeenNthCalledWith(1, { workspace: "figures", id: "f" });
    expect(onOpen).toHaveBeenNthCalledWith(2, { workspace: "timeline", id: "later" });
  });

  it("renders the empty inspector without editable fields", () => {
    render(
      <I18nProvider>
        <PlaceInspector
          selected={null}
          state={state}
          onPatch={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Ort auswählen")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
