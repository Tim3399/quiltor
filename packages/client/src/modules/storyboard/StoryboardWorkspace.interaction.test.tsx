import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { WorldReferenceTarget } from "../../shared";
import type { WorldReferenceCandidate } from "../world-references";
import { createDefaultStoryboardState, type StoryboardState } from "./model";
import { StoryboardWorkspace } from "./StoryboardWorkspace";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  Background: () => null,
  BackgroundVariant: { Lines: "lines" },
  ConnectionLineType: { SmoothStep: "smoothstep" },
  ConnectionMode: { Loose: "loose" },
  Controls: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ControlButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Handle: () => null,
  MiniMap: () => <div data-testid="storyboard-minimap" />,
  NodeResizer: () => null,
  Panel: ({ children }: { children: ReactNode }) => children,
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  ReactFlow: ({
    children,
    connectionLineType,
    defaultEdgeOptions,
    edges,
    nodes,
    nodeTypes,
    onInit,
    onConnect,
    onEdgeClick,
    onNodeDoubleClick,
    onNodeDrag,
    onNodeDragStop,
    nodeClickDistance,
    nodeDragThreshold,
  }: {
    children?: ReactNode;
    connectionLineType?: string;
    defaultEdgeOptions?: { type?: string };
    edges: Array<{
      id: string;
      source: string;
      target: string;
      label?: unknown;
      markerEnd?: unknown;
    }>;
    nodes: Array<{
      id: string;
      type?: string;
      data: Record<string, unknown>;
      position: { x: number; y: number };
      selected?: boolean;
    }>;
    nodeTypes?: Record<string, ComponentType<Record<string, unknown>>>;
    onInit?: (instance: {
      fitView: () => Promise<void>;
      setCenter: () => Promise<void>;
      setViewport: () => Promise<void>;
      screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
    }) => void;
    onConnect?: (connection: {
      source: string;
      target: string;
      sourceHandle: string;
      targetHandle: string;
    }) => void;
    onEdgeClick?: (event: unknown, edge: (typeof edges)[number]) => void;
    onNodeDoubleClick?: (event: unknown, node: (typeof nodes)[number]) => void;
    onNodeDrag?: (event: unknown, node: (typeof nodes)[number]) => void;
    onNodeDragStop?: (event: unknown, node: (typeof nodes)[number]) => void;
    nodeClickDistance?: number;
    nodeDragThreshold?: number;
  }) => {
    onInit?.({
      fitView: vi.fn(async () => undefined),
      setCenter: vi.fn(async () => undefined),
      setViewport: vi.fn(async () => undefined),
      screenToFlowPosition: () => ({ x: 320, y: 180 }),
    });
    const group = nodes.find(
      (node) => (node.data.item as { kind?: unknown } | undefined)?.kind === "group",
    );
    return (
      <div
        data-testid="storyboard-flow"
        data-connection-line-type={connectionLineType}
        data-default-edge-type={defaultEdgeOptions?.type}
        data-node-click-distance={nodeClickDistance}
        data-node-drag-threshold={nodeDragThreshold}
      >
        <output aria-label="Flow-Positionen">
          {JSON.stringify(
            nodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
          )}
        </output>
        <output aria-label="Flow-Auswahl">
          {JSON.stringify(nodes.filter((node) => node.selected).map((node) => node.id))}
        </output>
        <output aria-label="Flow-Kanten">{JSON.stringify(edges)}</output>
        {nodes.map((node) => {
          const Node = nodeTypes?.[node.type ?? ""];
          return Node ? <Node key={node.id} id={node.id} data={node.data} selected /> : null;
        })}
        {nodes[0] && (
          <button type="button" onClick={() => onNodeDoubleClick?.(null, nodes[0])}>
            Test-Doppelklick
          </button>
        )}
        {nodes.length >= 2 && (
          <button
            type="button"
            onClick={() =>
              onConnect?.({
                source: nodes[0].id,
                target: nodes[1].id,
                sourceHandle: "neutral-bottom",
                targetHandle: "neutral-top",
              })
            }
          >
            Test-Verbindung erstellen
          </button>
        )}
        {edges[0] && (
          <button type="button" onClick={() => onEdgeClick?.(null, edges[0])}>
            Test-Verbindung auswählen
          </button>
        )}
        {group && (
          <>
            <button
              type="button"
              onClick={() => {
                const moved = {
                  ...group,
                  position: { x: group.position.x + 80, y: group.position.y - 40 },
                };
                onNodeDrag?.(null, moved);
              }}
            >
              Test-Gruppenvorschau
            </button>
            <button
              type="button"
              onClick={() => {
                const moved = {
                  ...group,
                  position: { x: group.position.x + 80, y: group.position.y - 40 },
                };
                onNodeDrag?.(null, moved);
                onNodeDragStop?.(null, moved);
              }}
            >
              Test-Gruppe verschieben
            </button>
          </>
        )}
        {children}
      </div>
    );
  },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
}));

afterEach(cleanup);

const ada: WorldReferenceCandidate = {
  id: "entity:ada",
  target: { kind: "entity", id: "ada" },
  label: "Ada",
  detail: "Figur",
  keywords: [],
  workspace: "figures",
  cardKind: "person",
};

function dragTransfer() {
  const values = new Map<string, string>();
  const types: string[] = [];
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    types,
    setData(type: string, value: string) {
      values.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
  } as unknown as DataTransfer;
}

function Harness({
  initialState = createDefaultStoryboardState(),
  candidates = [],
  onChange = vi.fn(),
  onOpenReference = vi.fn(),
  targetId,
  targetRequestId,
}: {
  initialState?: StoryboardState;
  candidates?: readonly WorldReferenceCandidate[];
  onChange?: (value: StoryboardState) => void;
  onOpenReference?: (target: WorldReferenceTarget) => void;
  targetId?: string;
  targetRequestId?: number;
}) {
  const [state, setState] = useState(initialState);
  return (
    <I18nProvider>
      <output aria-label="Storyboard-Zustand">{JSON.stringify(state)}</output>
      <StoryboardWorkspace
        state={state}
        candidates={candidates}
        onOpenReference={onOpenReference}
        targetId={targetId}
        targetRequestId={targetRequestId}
        onChange={(next) => {
          setState(next);
          onChange(next);
        }}
      />
    </I18nProvider>
  );
}

describe("StoryboardWorkspace interactions", () => {
  it("uses the shared viewport dock to show and hide its minimap", () => {
    const { container } = render(<Harness />);

    const canvas = container.querySelector(".storyboard-flow");
    expect(canvas).toHaveClass("has-minimap");
    expect(screen.getByTestId("storyboard-minimap")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Übersichtskarte ausblenden" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);

    expect(canvas).not.toHaveClass("has-minimap");
    expect(screen.queryByTestId("storyboard-minimap")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Übersichtskarte einblenden" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("adds, selects and renames another board, then places a group on it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Storyboard hinzufügen" }));
    expect(screen.getByRole("combobox", { name: "Storyboard auswählen" })).toHaveTextContent(
      "Neues Storyboard 2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Storyboard umbenennen" }));
    const boardName = screen.getByRole("textbox", { name: "Storyboard-Name" });
    fireEvent.change(boardName, { target: { value: "Zweiter Akt" } });
    fireEvent.blur(boardName);
    expect(screen.getByRole("combobox", { name: "Storyboard auswählen" })).toHaveTextContent(
      "Zweiter Akt",
    );

    fireEvent.click(screen.getByRole("button", { name: "Gruppe hinzufügen" }));
    const latest = onChange.mock.calls.at(-1)?.[0] as StoryboardState;
    expect(latest.boards).toHaveLength(2);
    expect(latest.nodes).toEqual([
      expect.objectContaining({ boardId: latest.boards[1].id, kind: "group" }),
    ]);
  });

  it("opens the owning board and selects a card targeted by a backlink", () => {
    const initialState: StoryboardState = {
      boards: [
        { id: "main-storyboard", title: "Hauptboard" },
        { id: "second-board", title: "Zweiter Akt" },
      ],
      nodes: [
        {
          id: "reference-ada",
          boardId: "second-board",
          kind: "reference",
          target: { kind: "entity", id: "ada" },
          x: 420,
          y: 240,
        },
      ],
      edges: [],
    };

    render(
      <Harness
        initialState={initialState}
        candidates={[ada]}
        targetId="reference-ada"
        targetRequestId={1}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Storyboard auswählen" })).toHaveTextContent(
      "Zweiter Akt",
    );
    expect(screen.getByLabelText("Flow-Auswahl")).toHaveTextContent('["reference-ada"]');
  });

  it("places a world reference from search and opens its original on double click", () => {
    const onOpenReference = vi.fn();
    render(<Harness candidates={[ada]} onOpenReference={onOpenReference} />);

    fireEvent.click(screen.getByRole("button", { name: "Ada auf dem Storyboard platzieren" }));
    expect(document.querySelector('[data-storyboard-node-kind="reference"]')).toHaveTextContent(
      "Ada",
    );

    fireEvent.click(screen.getByRole("button", { name: "Test-Doppelklick" }));
    expect(onOpenReference).toHaveBeenCalledWith({ kind: "entity", id: "ada" });
  });

  it("drops a world reference through the empty-state overlay onto the full canvas", () => {
    const onChange = vi.fn();
    const dataTransfer = dragTransfer();
    render(<Harness candidates={[ada]} onChange={onChange} />);

    fireEvent.dragStart(screen.getByRole("button", { name: "Ada auf dem Storyboard platzieren" }), {
      dataTransfer,
    });
    const emptyState = screen.getByLabelText("Platz für deine Ideen");
    fireEvent.dragOver(emptyState, { dataTransfer, clientX: 960, clientY: 640 });
    expect(dataTransfer.dropEffect).toBe("copy");
    fireEvent.drop(emptyState, { dataTransfer, clientX: 960, clientY: 640 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: [
          expect.objectContaining({
            boardId: "main-storyboard",
            kind: "reference",
            target: { kind: "entity", id: "ada" },
            x: 320,
            y: 180,
          }),
        ],
      }),
    );
  });

  it("connects cards, edits the selected edge, directs it, and reverses its endpoints", () => {
    const initialState: StoryboardState = {
      ...createDefaultStoryboardState(),
      nodes: [
        {
          id: "start",
          boardId: "main-storyboard",
          kind: "note",
          x: 40,
          y: 80,
          text: "Anfang",
        },
        {
          id: "end",
          boardId: "main-storyboard",
          kind: "note",
          x: 420,
          y: 240,
          text: "Ende",
        },
      ],
    };
    const onChange = vi.fn();
    render(<Harness initialState={initialState} onChange={onChange} />);

    expect(screen.getByTestId("storyboard-flow")).toHaveAttribute(
      "data-connection-line-type",
      "smoothstep",
    );
    expect(screen.getByTestId("storyboard-flow")).toHaveAttribute(
      "data-default-edge-type",
      "smoothstep",
    );
    expect(screen.getByTestId("storyboard-flow")).toHaveAttribute("data-node-click-distance", "6");
    expect(screen.getByTestId("storyboard-flow")).toHaveAttribute("data-node-drag-threshold", "6");

    fireEvent.click(screen.getByRole("button", { name: "Test-Verbindung erstellen" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        edges: [
          expect.objectContaining({
            sourceNodeId: "start",
            targetNodeId: "end",
            directed: false,
          }),
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Test-Verbindung auswählen" }));
    const inspector = screen.getByRole("region", { name: "Verbindung" });
    fireEvent.change(screen.getByRole("textbox", { name: "Beschriftung" }), {
      target: { value: "führt zu" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Kantenfarbe" }));
    fireEvent.click(screen.getByRole("option", { name: "Rosa" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Linienart" }));
    fireEvent.click(screen.getByRole("option", { name: "Gepunktet" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gerichtet" }));
    fireEvent.click(screen.getByRole("button", { name: "Richtung umkehren" }));

    expect(inspector).toHaveTextContent("Notiz → Notiz");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        edges: [
          expect.objectContaining({
            sourceNodeId: "end",
            targetNodeId: "start",
            label: "führt zu",
            directed: true,
            color: "rose",
            lineStyle: "dotted",
          }),
        ],
      }),
    );
    expect(screen.getByLabelText("Flow-Kanten")).toHaveTextContent('"label":"führt zu"');
    expect(screen.getByLabelText("Flow-Kanten")).toHaveTextContent(
      '"markerEnd":{"type":"arrowclosed","color":"var(--graph-edge-color-rose)"}',
    );
  });

  it("persists a group drag together with fully enclosed nodes only", () => {
    const initialState: StoryboardState = {
      ...createDefaultStoryboardState(),
      nodes: [
        {
          id: "group",
          boardId: "main-storyboard",
          kind: "group",
          x: 100,
          y: 100,
          width: 500,
          height: 360,
          label: "Erster Akt",
        },
        {
          id: "inside",
          boardId: "main-storyboard",
          kind: "note",
          x: 140,
          y: 150,
          width: 120,
          height: 100,
          text: "Mitglied",
        },
        {
          id: "partly-outside",
          boardId: "main-storyboard",
          kind: "note",
          x: 550,
          y: 150,
          width: 100,
          height: 100,
          text: "Kein Mitglied",
        },
        {
          id: "nested-group",
          boardId: "main-storyboard",
          kind: "group",
          x: 180,
          y: 180,
          width: 180,
          height: 120,
          label: "Unabhängige Gruppe",
        },
        {
          id: "nested-child",
          boardId: "main-storyboard",
          kind: "note",
          x: 200,
          y: 200,
          width: 80,
          height: 60,
          text: "In der Untergruppe",
        },
      ],
    };
    const onChange = vi.fn();
    render(<Harness initialState={initialState} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Test-Gruppe verschieben" }));

    const latest = onChange.mock.calls.at(-1)?.[0] as StoryboardState;
    const position = (id: string) => {
      const node = latest.nodes.find((candidate) => candidate.id === id);
      return node ? { x: node.x, y: node.y } : undefined;
    };
    expect(position("group")).toEqual({ x: 180, y: 60 });
    expect(position("inside")).toEqual({ x: 220, y: 110 });
    expect(position("partly-outside")).toEqual({ x: 550, y: 150 });
    expect(position("nested-group")).toEqual({ x: 260, y: 140 });
    expect(position("nested-child")).toEqual({ x: 280, y: 160 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("previews every grouped position without persisting or accumulating drift", () => {
    const initialState: StoryboardState = {
      ...createDefaultStoryboardState(),
      nodes: [
        {
          id: "group",
          boardId: "main-storyboard",
          kind: "group",
          x: 100,
          y: 100,
          width: 400,
          height: 300,
          label: "Akt",
        },
        {
          id: "inside",
          boardId: "main-storyboard",
          kind: "note",
          x: 140,
          y: 160,
          width: 100,
          height: 80,
          text: "Mitglied",
        },
      ],
    };
    const onChange = vi.fn();
    render(<Harness initialState={initialState} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Test-Gruppenvorschau" }));
    expect(screen.getByLabelText("Flow-Positionen")).toHaveTextContent(
      JSON.stringify([
        { id: "group", x: 180, y: 60 },
        { id: "inside", x: 220, y: 120 },
      ]),
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Test-Gruppenvorschau" }));
    expect(screen.getByLabelText("Flow-Positionen")).toHaveTextContent(
      JSON.stringify([
        { id: "group", x: 260, y: 20 },
        { id: "inside", x: 300, y: 80 },
      ]),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
