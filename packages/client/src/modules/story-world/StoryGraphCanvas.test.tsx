import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { StoryGraphCanvas } from "./StoryGraphCanvas";
import { storyNodeZoomStyle } from "./StoryNodeCard";

const flowStore = vi.hoisted(() => {
  const listeners = new Set<(state: { transform: [number, number, number] }) => void>();
  const store = {
    zoom: 1,
    listeners,
    getState: () => ({ transform: [0, 0, store.zoom] as [number, number, number] }),
    subscribe: (listener: (state: { transform: [number, number, number] }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Zooms the way React Flow's store does: listeners, no React render. */
    setZoom(zoom: number) {
      store.zoom = zoom;
      for (const listener of listeners) listener(store.getState());
    },
  };
  return store;
});

vi.mock("@xyflow/react", () => ({
  useStoreApi: () => flowStore,
  BackgroundVariant: { Lines: "lines" },
  Background: () => <div data-testid="background" />,
  Controls: ({ children }: { children?: ReactNode }) => (
    <div data-testid="controls">{children}</div>
  ),
  ControlButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  MiniMap: () => <div data-testid="minimap" />,
  ReactFlow: ({
    children,
    nodesDraggable,
    nodesConnectable,
    elementsSelectable,
    zoomOnScroll,
    zoomOnPinch,
    zoomOnDoubleClick,
    panOnDrag,
    panOnScroll,
  }: {
    children: ReactNode;
    nodesDraggable?: boolean;
    nodesConnectable?: boolean;
    elementsSelectable?: boolean;
    zoomOnScroll?: boolean;
    zoomOnPinch?: boolean;
    zoomOnDoubleClick?: boolean;
    panOnDrag?: boolean;
    panOnScroll?: boolean;
  }) => (
    <div
      data-testid="react-flow"
      data-nodes-draggable={String(nodesDraggable)}
      data-nodes-connectable={String(nodesConnectable)}
      data-elements-selectable={String(elementsSelectable)}
      data-navigation={JSON.stringify([
        zoomOnScroll,
        zoomOnPinch,
        zoomOnDoubleClick,
        panOnDrag,
        panOnScroll,
      ])}
    >
      {children}
    </div>
  ),
}));

afterEach(cleanup);

describe("StoryGraphCanvas", () => {
  it("writes the cards' zoom variables onto the surface on a zoom step, without a render", () => {
    flowStore.zoom = 0.2;
    let renders = 0;
    function Counted() {
      renders += 1;
      return null;
    }
    const view = render(
      <I18nProvider>
        <StoryGraphCanvas
          nodes={[]}
          edges={[]}
          zoomTier="overview"
          nodeZoomVariables
          gridSize={20}
          flowProps={{}}
          flowChildren={<Counted />}
        />
      </I18nProvider>,
    );
    const surface = view.container.querySelector<HTMLElement>(".flow-area");
    if (!surface) throw new Error("no surface");
    const expected = (zoom: number) =>
      render(<div style={storyNodeZoomStyle("overview", zoom)} />).container
        .firstElementChild as HTMLElement;
    expect(surface.style.getPropertyValue("--node-compact-width")).toBe(
      expected(0.2).style.getPropertyValue("--node-compact-width"),
    );
    const rendered = renders;

    flowStore.setZoom(0.2234);

    // Rounded to hundredths, as the board's own state did.
    expect(surface.style.getPropertyValue("--node-compact-width")).toBe(
      expected(0.22).style.getPropertyValue("--node-compact-width"),
    );
    expect(surface.style.getPropertyValue("--semantic-scale")).toBe(
      expected(0.22).style.getPropertyValue("--semantic-scale"),
    );
    expect(renders).toBe(rendered);
    view.unmount();
    expect(flowStore.listeners.size).toBe(0);
    flowStore.zoom = 1;
  });

  it("provides graph chrome and suppresses the overview grid", () => {
    const view = render(
      <I18nProvider>
        <StoryGraphCanvas
          nodes={[{ id: "node", position: { x: 0, y: 0 }, data: {} }]}
          edges={[]}
          zoomTier="overview"
          gridSize={20}
          flowProps={{}}
          overlay={<span>Mode</span>}
        >
          <span>Empty</span>
        </StoryGraphCanvas>
      </I18nProvider>,
    );

    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
    expect(screen.getByTestId("minimap")).toBeInTheDocument();
    expect(view.container.querySelector(".flow-area")).toHaveClass("has-minimap");
    fireEvent.click(screen.getByRole("button", { name: "Übersichtskarte ausblenden" }));
    expect(screen.queryByTestId("minimap")).not.toBeInTheDocument();
    expect(view.container.querySelector(".flow-area")).not.toHaveClass("has-minimap");
    expect(screen.getByRole("button", { name: "Übersichtskarte einblenden" })).toBeVisible();
    expect(screen.queryByTestId("background")).not.toBeInTheDocument();
    expect(screen.getByText("Mode")).toBeInTheDocument();
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("keeps the shared figure and place navigation controls touch-safe", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/GraphViewportChrome.css"),
      "utf8",
    );
    const touchRules = css.match(
      /@media \(max-width: 719px\), \(pointer: coarse\)\s*\{([\s\S]*)\}\s*$/,
    )?.[1];

    expect(touchRules).toMatch(
      /\.graph-viewport-surface \.react-flow__controls-button\s*\{[^}]*width:\s*var\(--control-touch\);[^}]*height:\s*var\(--control-touch\);/s,
    );
    expect(touchRules).toMatch(
      /\.graph-viewport-surface \.react-flow__controls-button svg\s*\{[^}]*max-width:\s*var\(--space-16\);[^}]*max-height:\s*var\(--space-16\);/s,
    );
    expect(touchRules).toMatch(
      /\.graph-viewport-surface \.react-flow__attribution a\s*\{[^}]*min-width:\s*var\(--control-touch\);[^}]*min-height:\s*var\(--control-touch\);/s,
    );
  });

  it("maps the third-party graph controls onto the active Quiltor theme", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/graph/GraphViewportChrome.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.graph-viewport-surface \.react-flow\s*\{[^}]*--xy-controls-button-background-color:\s*var\(--paper\);[^}]*--xy-controls-button-background-color-hover:\s*var\(--panel\);[^}]*--xy-controls-button-color:\s*var\(--ink\);[^}]*--xy-controls-button-border-color:\s*var\(--line\);/s,
    );
    expect(css).toMatch(
      /\.graph-viewport-surface \.react-flow\s*\{[^}]*--xy-attribution-background-color:\s*var\(--paper\);[^}]*--xy-minimap-background-color:\s*var\(--panel\);/s,
    );
    expect(css).toMatch(
      /\.graph-viewport-surface \.react-flow__attribution a\s*\{[^}]*color:\s*var\(--attribution\);/s,
    );
  });
});

describe("whether the surface lets nodes be dragged", () => {
  const canvas = (flowProps: { nodesDraggable?: boolean }) =>
    render(
      <I18nProvider>
        <StoryGraphCanvas
          nodes={[{ id: "node", position: { x: 0, y: 0 }, data: {} }]}
          edges={[]}
          zoomTier="detail"
          gridSize={20}
          flowProps={flowProps}
        />
      </I18nProvider>,
    );

  it("keeps nodes still when the caller says so", () => {
    canvas({ nodesDraggable: false });
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-nodes-draggable", "false");
  });

  it("lets nodes be dragged when the caller says nothing", () => {
    canvas({});
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-nodes-draggable", "true");
  });

  it("keeps nodes still under a closed lock, whatever the caller says", () => {
    canvas({ nodesDraggable: true });
    fireEvent.click(screen.getByRole("button", { name: "Anordnen sperren" }));
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-nodes-draggable", "false");
  });

  it("locks dragging, connecting and selecting under a closed lock and leaves zoom and pan alone", () => {
    canvas({});
    const flow = screen.getByTestId("react-flow");
    const navigation = flow.getAttribute("data-navigation");
    fireEvent.click(screen.getByRole("button", { name: "Anordnen sperren" }));
    expect(flow).toHaveAttribute("data-nodes-draggable", "false");
    expect(flow).toHaveAttribute("data-nodes-connectable", "false");
    expect(flow).toHaveAttribute("data-elements-selectable", "false");
    expect(flow).toHaveAttribute("data-navigation", navigation);
    fireEvent.click(screen.getByRole("button", { name: "Anordnen freigeben" }));
    expect(flow).toHaveAttribute("data-nodes-draggable", "true");
    expect(flow).toHaveAttribute("data-nodes-connectable", "true");
    expect(flow).toHaveAttribute("data-elements-selectable", "true");
  });

  it("names the dock padlock by what it does and shows its state", () => {
    canvas({});
    const lock = screen.getByRole("button", { name: "Anordnen sperren" });
    expect(lock).toHaveAttribute("aria-pressed", "false");
    expect(lock).toHaveAttribute("title", "Anordnen sperren");
    fireEvent.click(lock);
    const locked = screen.getByRole("button", { name: "Anordnen freigeben" });
    expect(locked).toHaveAttribute("aria-pressed", "true");
    expect(locked).toHaveAttribute("title", "Anordnen freigeben");
  });
});
