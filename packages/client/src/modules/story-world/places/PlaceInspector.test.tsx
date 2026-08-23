import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  it("keeps history rows inside their cards with compact, wrapping layout contracts", () => {
    const { container } = render(
      <I18nProvider>
        <PlaceInspector
          selected={state.nodes[0]}
          state={state}
          onPatch={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />
      </I18nProvider>,
    );

    const whoWasHere = screen.getByText("Wer war hier").closest("details");
    const chronicle = screen.getByText("Chronik").closest("details");
    expect(whoWasHere?.querySelector("summary > .places-section-heading")).toBeInTheDocument();
    expect(whoWasHere?.querySelector(".places-stay-row .places-stay-range")).toBeInTheDocument();
    expect(chronicle?.querySelector(".places-chronicle-entry")).toBeInTheDocument();
    expect(container.querySelector(".places-inspector-body")).toBeInTheDocument();

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/places/PlaceInspector.css"),
      "utf8",
    );
    expect(css).toMatch(/\.places-section-heading\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
    expect(css).toMatch(
      /\.places-stay-row\s*\{[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s,
    );
    expect(css).toMatch(
      /\.places-stay-range\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\);/s,
    );
    expect(css).toMatch(
      /\.places-stay-duration\s*\{[^}]*min-width:\s*max-content;[^}]*overflow-wrap:\s*normal;[^}]*white-space:\s*nowrap;/s,
    );
    expect(css).toMatch(/\.places-chronicle-entry\s*>\s*strong,[\s\S]*?overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(
      /\.places-inspector-body\s*\{[^}]*overflow-x:\s*hidden;[^}]*scrollbar-color:\s*var\(--line-strong\)\s+var\(--transparent\);/s,
    );
    expect(css).toContain(".places-inspector-body::-webkit-scrollbar-thumb");
  });

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
