import { act, renderHook } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import type { FigureFlowNode } from "./FigureNode";
import { useFigureCanvas } from "./useFigureCanvas";

afterEach(() => vi.restoreAllMocks());

const NO_MOMENTS: never[] = [];

const state: FigureState = {
  nodes: [
    { id: "a", x: 0, y: 0, name: "Ada", type: "person" },
    { id: "b", x: 100, y: 0, name: "Bela", type: "person" },
  ],
  edges: [],
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </I18nProvider>
  );
}

function setup(onChange: (next: FigureState) => void) {
  return renderHook(
    () =>
      useFigureCanvas({
        state,
        onChange,
        selected: null,
        timeline: NO_MOMENTS,
        presence: NO_MOMENTS,
        activeMomentId: null,
        journeyOverlayOpen: false,
        relationshipsVisible: true,
        selectedEdgeId: null,
        onSelectNode: vi.fn(),
        onSelectEdge: vi.fn(),
        onStopConnecting: vi.fn(),
        onEnsureRelationshipsVisible: vi.fn(),
        onConnectionError: vi.fn(),
      }),
    { wrapper },
  );
}

const dragEnd = (id: string, x: number, y: number) =>
  ({ id, position: { x, y } }) as unknown as FigureFlowNode;

describe("useFigureCanvas", () => {
  it("builds a second drag end on the first when both land before the next commit", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    const onChange = vi.fn();
    const { result } = setup(onChange);

    act(() => {
      result.current.onNodeDragStop(dragEnd("a", 10, 20));
      result.current.onNodeDragStop(dragEnd("b", 30, 40));
    });

    const last = onChange.mock.calls.at(-1)?.[0] as FigureState;
    expect(last.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: "a", x: 10, y: 20 },
      { id: "b", x: 30, y: 40 },
    ]);
  });
});
