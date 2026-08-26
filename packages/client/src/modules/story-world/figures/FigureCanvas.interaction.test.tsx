import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { FigureCanvas } from "./FigureCanvas";
import type { FigureFlowNode } from "./FigureNode";
import type { FigureCanvasController } from "./useFigureCanvas";

vi.mock("../StoryGraphCanvas", () => ({
  StoryGraphCanvas: ({
    nodes,
    flowProps,
    children,
  }: {
    nodes: FigureFlowNode[];
    flowProps: {
      onNodeContextMenu?: (event: ReactMouseEvent<HTMLElement>, node: FigureFlowNode) => void;
    };
    children?: ReactNode;
  }) => (
    <div className="flow-area">
      {nodes.map((node) => (
        // biome-ignore lint/a11y/useSemanticElements: React Flow exposes its focusable node wrapper as a div with button semantics.
        <div
          className="react-flow__node"
          data-id={node.id}
          key={node.id}
          role="button"
          tabIndex={0}
          onContextMenu={(event) => flowProps.onNodeContextMenu?.(event, node)}
        >
          {node.id}
        </div>
      ))}
      {children}
    </div>
  ),
}));

const node: FigureFlowNode = {
  id: "ada",
  type: "story",
  position: { x: 0, y: 0 },
  data: {
    figure: { id: "ada", x: 0, y: 0, name: "Ada", type: "person" },
    deceased: false,
    guests: [],
    zoomTier: "detail",
    zoom: 1,
  },
};

function controller(): FigureCanvasController {
  return {
    nodes: [node],
    edges: [],
    zoomTier: "detail",
    snapToGrid: true,
    gridOverride: false,
    setSnapToGrid: vi.fn(),
    addNode: vi.fn(),
    alignAllNodes: vi.fn(),
    centerOnNode: vi.fn(),
    onConnect: vi.fn(),
    onInit: vi.fn(),
    onMove: vi.fn(),
    onNodesChange: vi.fn(),
    onNodeDragStop: vi.fn(),
  };
}

function renderCanvas(onOpenNodeMenu = vi.fn()) {
  render(
    <I18nProvider>
      <section className="figure-workspace">
        <FigureCanvas
          controller={controller()}
          connecting={false}
          playing={false}
          onCancelConnecting={vi.fn()}
          onSelectNode={vi.fn()}
          onOpenNodeMenu={onOpenNodeMenu}
          onClearSelection={vi.fn()}
        />
      </section>
    </I18nProvider>,
  );
  const trigger = screen.getByRole("button", { name: "ada" });
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 60,
    left: 100,
    top: 60,
    right: 300,
    bottom: 156,
    width: 200,
    height: 96,
    toJSON: () => ({}),
  });
  return { onOpenNodeMenu, trigger };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FigureCanvas node menu interactions", () => {
  it("opens the focused node from ContextMenu and Shift+F10 at its visual center", () => {
    const { onOpenNodeMenu, trigger } = renderCanvas();
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ContextMenu" });
    fireEvent.keyDown(trigger, { key: "F10", shiftKey: true });

    expect(onOpenNodeMenu).toHaveBeenNthCalledWith(1, node, 200, 108, trigger);
    expect(onOpenNodeMenu).toHaveBeenNthCalledWith(2, node, 200, 108, trigger);
  });

  it("falls back to node geometry for a keyboard-generated contextmenu event", () => {
    const { onOpenNodeMenu, trigger } = renderCanvas();
    fireEvent.contextMenu(trigger, { clientX: 0, clientY: 0 });
    expect(onOpenNodeMenu).toHaveBeenCalledWith(node, 200, 108, trigger);
  });

  it("offers touch long-press without firing after a drag gesture", () => {
    vi.useFakeTimers();
    const { onOpenNodeMenu, trigger } = renderCanvas();

    fireEvent.pointerDown(trigger, { pointerType: "touch", clientX: 140, clientY: 90 });
    vi.advanceTimersByTime(550);
    expect(onOpenNodeMenu).toHaveBeenCalledWith(node, 140, 90, trigger);

    onOpenNodeMenu.mockClear();
    fireEvent.pointerDown(trigger, { pointerType: "touch", clientX: 140, clientY: 90 });
    fireEvent.pointerMove(trigger, { pointerType: "touch", clientX: 160, clientY: 110 });
    vi.advanceTimersByTime(600);
    expect(onOpenNodeMenu).not.toHaveBeenCalled();
  });
});
