import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  type Edge,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from "@xyflow/react";
import { Plus, StickyNote } from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, ScrollArea } from "../../design";
import { useI18n } from "../../i18n";
import type { NoteMark, NoteReference, WorldReferenceTarget } from "../../shared";
import {
  cardKindColor,
  GraphViewportChrome,
  graphConnectionKey,
  graphRelationshipEdgeTypes,
  positionGraphRelationshipEdgeLabels,
} from "../graph";
import { type WorldReferenceCandidate, worldReferenceKey } from "../world-references";
import type {
  StoryboardBoard,
  StoryboardBoardNode,
  StoryboardEdge,
  StoryboardNoteNode,
  StoryboardReferenceNode,
  StoryboardState,
} from "./model";
import { createDefaultStoryboardState, DEFAULT_STORYBOARD_ID } from "./model";
import { StoryboardEdgeInspector } from "./StoryboardEdgeInspector";
import { storyboardNodeTypes } from "./StoryboardNode";
import { StoryboardSearchPanel } from "./StoryboardSearchPanel";
import { StoryboardToolbar } from "./StoryboardToolbar";
import {
  candidateForDragValue,
  candidateNode,
  connectedStoryboardEdge,
  groupNode,
  moveStoryboardNodeWithGroupMembers,
  noteNode,
  STORYBOARD_GRID_SIZE,
  STORYBOARD_REFERENCE_DRAG_MIME,
  type StoryboardFlowNode,
  type StoryboardNodePatch,
  storyboardCardKind,
  storyboardFlowEdge,
  storyboardFlowNode,
  uniqueStoryboardId,
  updateStoryboardNodeNote,
} from "./storyboardCanvasModel";
import "./StoryboardWorkspace.css";

export type StoryboardWorkspaceProps = {
  state: StoryboardState;
  onChange: (value: StoryboardState) => void;
  candidates: readonly WorldReferenceCandidate[];
  onOpenReference: (target: WorldReferenceTarget) => void;
  targetId?: string;
  targetRequestId?: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
};

export function StoryboardWorkspace(props: StoryboardWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <StoryboardWorkspaceInner {...props} />
    </ReactFlowProvider>
  );
}

function StoryboardWorkspaceInner({
  state,
  onChange,
  candidates,
  onOpenReference,
  targetId,
  targetRequestId,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: StoryboardWorkspaceProps) {
  const { t } = useI18n();
  const fallbackBoard = useMemo(() => createDefaultStoryboardState().boards[0], []);
  const boards = useMemo(
    () => (state.boards.length ? state.boards : [fallbackBoard]),
    [fallbackBoard, state.boards],
  );
  const [activeBoardId, setActiveBoardId] = useState(boards[0]?.id ?? DEFAULT_STORYBOARD_ID);
  const [boardTrail, setBoardTrail] = useState<string[]>([activeBoardId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [query, setQuery] = useState("");
  const [flowNodes, setFlowNodes] = useState<StoryboardFlowNode[]>([]);
  const flow = useRef<ReactFlowInstance<StoryboardFlowNode, Edge> | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const latestState = useRef(state);
  const latestCandidates = useRef(candidates);
  const activeBoardIdRef = useRef(activeBoardId);
  const skipNextBoardFit = useRef(false);
  latestState.current = state;
  activeBoardIdRef.current = activeBoardId;

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];
  const currentBoardId = activeBoard?.id ?? DEFAULT_STORYBOARD_ID;
  const activeNodes = useMemo(
    () => state.nodes.filter((node) => node.boardId === currentBoardId),
    [currentBoardId, state.nodes],
  );
  const activeEdges = useMemo(
    () => state.edges.filter((edge) => edge.boardId === currentBoardId),
    [currentBoardId, state.edges],
  );
  const selectEdgeFromLabel = useCallback((edgeId: string) => {
    setSelectedId(null);
    setSelectedEdgeId(edgeId);
  }, []);
  const renderedEdges = useMemo(
    () =>
      positionGraphRelationshipEdgeLabels(
        flowNodes,
        activeEdges.map((edge) => ({
          ...storyboardFlowEdge(edge, activeNodes),
          selected: edge.id === selectedEdgeId,
        })),
        { onLabelClick: selectEdgeFromLabel },
      ),
    [activeEdges, activeNodes, flowNodes, selectEdgeFromLabel, selectedEdgeId],
  );
  const selectedEdge = activeEdges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const noteBoardContext =
    boardTrail
      .map((id) => boards.find((board) => board.id === id)?.title)
      .filter(Boolean)
      .join(" / ") ||
    activeBoard?.title ||
    t("storyboardTitle");

  const allCandidates = useMemo(() => {
    const byTarget = new Map(
      candidates
        .filter(
          (candidate) =>
            candidate.target.kind !== "storyboard" ||
            boards.some((board) => board.id === candidate.target.id),
        )
        .map((candidate) => [worldReferenceKey(candidate.target), candidate]),
    );
    for (const board of boards) {
      const target = { kind: "storyboard" as const, id: board.id };
      byTarget.set(worldReferenceKey(target), {
        id: worldReferenceKey(target),
        target,
        label: board.title,
        detail: t("storyboardBoardKind"),
        keywords: [board.title],
        workspace: "storyboard",
        cardKind: "storyboard",
      });
    }
    return [...byTarget.values()];
  }, [boards, candidates, t]);
  latestCandidates.current = allCandidates;

  const changeFromLatest = useCallback(
    (update: (current: StoryboardState) => StoryboardState) => {
      const current = latestState.current;
      const initialized = current.boards.length ? current : { ...current, boards: [fallbackBoard] };
      const next = update(initialized);
      if (next === current) return;
      latestState.current = next;
      onChange(next);
    },
    [fallbackBoard, onChange],
  );

  const patchNode = useCallback(
    (id: string, patch: StoryboardNodePatch) =>
      changeFromLatest((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      })),
    [changeFromLatest],
  );

  const changeNote = useCallback(
    (
      id: string,
      text: string,
      references: NoteReference[] | undefined,
      marks: NoteMark[] | undefined,
    ) =>
      changeFromLatest((current) => ({
        ...current,
        nodes: updateStoryboardNodeNote(current.nodes, id, text, references, marks),
      })),
    [changeFromLatest],
  );

  const openBoard = useCallback((node: StoryboardBoardNode) => {
    const targetId = node.target.id;
    if (!latestState.current.boards.some((board) => board.id === targetId)) return;
    setActiveBoardId(targetId);
    setBoardTrail((trail) => [...trail, targetId]);
    setSelectedId(null);
  }, []);

  const openReference = useCallback(
    (node: StoryboardReferenceNode) => onOpenReference(node.target),
    [onOpenReference],
  );

  const derivedNodes = useMemo(
    () =>
      activeNodes.map((item) => ({
        ...storyboardFlowNode(
          item,
          {
            boardTitle:
              item.kind === "storyboard"
                ? boards.find((board) => board.id === item.target.id)?.title
                : undefined,
            boardContext: noteBoardContext,
            onPatch: patchNode,
            onNoteChange: changeNote,
            onOpenReference: openReference,
            onOpenBoard: openBoard,
          },
          storyboardCardKind(item, allCandidates),
        ),
        selected: item.id === selectedId,
      })),
    [
      activeNodes,
      allCandidates,
      boards,
      changeNote,
      noteBoardContext,
      openBoard,
      openReference,
      patchNode,
      selectedId,
    ],
  );

  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);

  useEffect(() => {
    if (boards.some((board) => board.id === activeBoardId)) return;
    const next = boards[0]?.id ?? DEFAULT_STORYBOARD_ID;
    setActiveBoardId(next);
    setBoardTrail([next]);
    setSelectedId(null);
    setSelectedEdgeId(null);
  }, [activeBoardId, boards]);

  useEffect(() => {
    if (skipNextBoardFit.current) {
      skipNextBoardFit.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const instance = flow.current;
      if (!instance) return;
      const hasNodes = latestState.current.nodes.some((node) => node.boardId === currentBoardId);
      if (hasNodes) {
        void instance.fitView({ duration: 350, padding: 0.18 });
      } else {
        void instance.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 350 });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentBoardId]);

  useEffect(() => {
    // A new request id intentionally replays navigation even when the stable target id is equal.
    void targetRequestId;
    if (!targetId) return;
    const current = latestState.current;
    const board = current.boards.find((candidate) => candidate.id === targetId);
    if (board) {
      setActiveBoardId(board.id);
      setBoardTrail([board.id]);
      setSelectedId(null);
      setSelectedEdgeId(null);
      window.setTimeout(() => {
        const instance = flow.current;
        if (!instance) return;
        const hasNodes = latestState.current.nodes.some((node) => node.boardId === board.id);
        if (hasNodes) void instance.fitView({ duration: 350, padding: 0.18 });
        else void instance.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 350 });
      }, 0);
      return;
    }
    const node = current.nodes.find((candidate) => candidate.id === targetId);
    if (!node) return;
    if (activeBoardIdRef.current !== node.boardId) skipNextBoardFit.current = true;
    setActiveBoardId(node.boardId);
    setBoardTrail([node.boardId]);
    setSelectedId(node.id);
    setSelectedEdgeId(null);
    window.setTimeout(
      () =>
        flow.current?.setCenter(node.x + (node.width ?? 0) / 2, node.y + (node.height ?? 0) / 2, {
          zoom: 1,
          duration: 350,
        }),
      0,
    );
  }, [targetId, targetRequestId]);

  const positionAtCanvasCenter = useCallback(() => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (bounds && flow.current) {
      return flow.current.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
    }
    const offset = activeNodes.length * STORYBOARD_GRID_SIZE;
    return { x: 180 + offset, y: 140 + offset };
  }, [activeNodes.length]);

  const addNote = useCallback(
    (position = positionAtCanvasCenter()) => {
      let created: StoryboardNoteNode | null = null;
      changeFromLatest((current) => {
        created = noteNode(
          currentBoardId,
          position,
          current.nodes.map((node) => node.id),
        );
        return { ...current, nodes: [...current.nodes, created] };
      });
      if (created) setSelectedId((created as StoryboardNoteNode).id);
      setSelectedEdgeId(null);
    },
    [changeFromLatest, currentBoardId, positionAtCanvasCenter],
  );

  const addGroup = useCallback(
    (label: string) => {
      let createdId = "";
      changeFromLatest((current) => {
        const created = groupNode(
          currentBoardId,
          positionAtCanvasCenter(),
          current.nodes.map((node) => node.id),
          label,
        );
        createdId = created.id;
        return { ...current, nodes: [created, ...current.nodes] };
      });
      setSelectedId(createdId);
      setSelectedEdgeId(null);
    },
    [changeFromLatest, currentBoardId, positionAtCanvasCenter],
  );

  const placeCandidate = useCallback(
    (candidate: WorldReferenceCandidate, position = positionAtCanvasCenter()) => {
      let createdId = "";
      changeFromLatest((current) => {
        const created = candidateNode(
          currentBoardId,
          position,
          current.nodes.map((node) => node.id),
          candidate,
        );
        createdId = created.id;
        return { ...current, nodes: [...current.nodes, created] };
      });
      setSelectedId(createdId);
      setSelectedEdgeId(null);
    },
    [changeFromLatest, currentBoardId, positionAtCanvasCenter],
  );

  const previewGroupMove = useCallback((id: string, position: { x: number; y: number }) => {
    const currentNodes = latestState.current.nodes;
    if (currentNodes.find((node) => node.id === id)?.kind !== "group") return;
    const previewNodes = moveStoryboardNodeWithGroupMembers(currentNodes, id, position);
    if (previewNodes === currentNodes) return;
    const previewPositions = new Map(
      previewNodes.map((node) => [node.id, { x: node.x, y: node.y }] as const),
    );
    setFlowNodes((current) =>
      current.map((node) => {
        const previewPosition = previewPositions.get(node.id);
        if (!previewPosition) return node;
        if (node.position.x === previewPosition.x && node.position.y === previewPosition.y) {
          return node;
        }
        return { ...node, position: previewPosition };
      }),
    );
  }, []);

  const commitNodeMove = useCallback(
    (id: string, position: { x: number; y: number }) =>
      changeFromLatest((current) => {
        const nodes = moveStoryboardNodeWithGroupMembers(current.nodes, id, position);
        return nodes === current.nodes ? current : { ...current, nodes };
      }),
    [changeFromLatest],
  );

  const addBoard = useCallback(
    (title: string) => {
      let created: StoryboardBoard | null = null;
      changeFromLatest((current) => {
        const id = uniqueStoryboardId(
          "storyboard-",
          [...current.boards, ...current.nodes].map((item) => item.id),
        );
        created = {
          id,
          title,
        };
        return { ...current, boards: [...current.boards, created] };
      });
      if (!created) return;
      const board = created as StoryboardBoard;
      setActiveBoardId(board.id);
      setBoardTrail([board.id]);
      setSelectedId(null);
      setSelectedEdgeId(null);
    },
    [changeFromLatest],
  );

  const renameBoard = useCallback(
    (title: string) =>
      changeFromLatest((current) => {
        const board = current.boards.find((candidate) => candidate.id === currentBoardId);
        if (board?.title === title) return current;
        return {
          ...current,
          boards: current.boards.map((candidate) =>
            candidate.id === currentBoardId ? { ...candidate, title } : candidate,
          ),
        };
      }),
    [changeFromLatest, currentBoardId],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId && !selectedEdgeId) return;
    changeFromLatest((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selectedId),
      edges: current.edges.filter(
        (edge) =>
          edge.id !== selectedEdgeId &&
          edge.sourceNodeId !== selectedId &&
          edge.targetNodeId !== selectedId,
      ),
    }));
    setSelectedId(null);
    setSelectedEdgeId(null);
  }, [changeFromLatest, selectedEdgeId, selectedId]);

  const patchEdge = useCallback(
    (edgeId: string, patch: Partial<StoryboardEdge>) =>
      changeFromLatest((current) => ({
        ...current,
        edges: current.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
      })),
    [changeFromLatest],
  );

  const edgeConflicts = useCallback(
    (edge: StoryboardEdge, sourceNodeId: string, targetNodeId: string, directed: boolean) => {
      const candidateKey = graphConnectionKey(sourceNodeId, targetNodeId, directed);
      return activeEdges.some(
        (candidate) =>
          candidate.id !== edge.id &&
          graphConnectionKey(
            candidate.sourceNodeId,
            candidate.targetNodeId,
            candidate.directed === true,
          ) === candidateKey,
      );
    },
    [activeEdges],
  );

  const selectedEdgeSource = selectedEdge
    ? activeNodes.find((node) => node.id === selectedEdge.sourceNodeId)
    : undefined;
  const selectedEdgeTarget = selectedEdge
    ? activeNodes.find((node) => node.id === selectedEdge.targetNodeId)
    : undefined;
  const storyboardNodeLabel = (node: (typeof activeNodes)[number] | undefined) => {
    if (!node) return t("unknown");
    if (node.kind === "storyboard") {
      return (
        boards.find((board) => board.id === node.target.id)?.title || node.label || t("untitled")
      );
    }
    if (node.label?.trim()) return node.label;
    if (node.kind === "note") return t("storyboardNoteKind");
    if (node.kind === "group") return t("storyboardGroupKind");
    return t("storyboardReferenceKind");
  };
  const toggleEdgeConflict = selectedEdge
    ? edgeConflicts(
        selectedEdge,
        selectedEdge.sourceNodeId,
        selectedEdge.targetNodeId,
        selectedEdge.directed !== true,
      )
    : false;
  const reverseEdgeConflict = selectedEdge?.directed
    ? edgeConflicts(selectedEdge, selectedEdge.targetNodeId, selectedEdge.sourceNodeId, true)
    : false;

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const value = event.dataTransfer.getData(STORYBOARD_REFERENCE_DRAG_MIME);
      const candidate = candidateForDragValue(latestCandidates.current, value);
      if (!candidate) return;
      event.preventDefault();
      const position = flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      placeCandidate(candidate, position);
    },
    [placeCandidate],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(STORYBOARD_REFERENCE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const breadcrumbBoards = boardTrail.flatMap((id, index) => {
    const board = boards.find((candidate) => candidate.id === id);
    return board
      ? [
          {
            board,
            trailLength: index + 1,
            trailKey: boardTrail.slice(0, index + 1).join("/"),
          },
        ]
      : [];
  });

  return (
    <section className="storyboard-workspace" aria-label={t("storyboardTitle")}>
      <StoryboardToolbar
        boards={boards}
        currentBoardId={currentBoardId}
        currentBoardTitle={activeBoard?.title ?? ""}
        nodeCount={activeNodes.length}
        libraryOpen={libraryOpen}
        hasSelection={Boolean(selectedId || selectedEdgeId)}
        canUndo={canUndo}
        canRedo={canRedo}
        onSelectBoard={(id) => {
          setActiveBoardId(id);
          setBoardTrail([id]);
          setSelectedId(null);
          setSelectedEdgeId(null);
        }}
        onRenameBoard={renameBoard}
        onAddBoard={addBoard}
        onAddNote={() => addNote()}
        onAddGroup={addGroup}
        onLibraryOpenChange={setLibraryOpen}
        onUndo={onUndo}
        onRedo={onRedo}
        onDeleteSelection={deleteSelected}
      />
      <div className={`storyboard-layout ${libraryOpen ? "has-library" : ""}`.trim()}>
        {libraryOpen && (
          <StoryboardSearchPanel
            candidates={allCandidates}
            query={query}
            onQueryChange={setQuery}
            onPlace={placeCandidate}
          />
        )}
        <div ref={canvas} className="storyboard-canvas-shell">
          <div
            className={`storyboard-flow graph-edge-surface graph-viewport-surface ${minimapVisible ? "has-minimap" : ""}`}
            onDragOverCapture={onDragOver}
            onDropCapture={onDrop}
          >
            <ReactFlow<StoryboardFlowNode, Edge>
              nodes={flowNodes}
              edges={renderedEdges}
              nodeTypes={storyboardNodeTypes}
              edgeTypes={graphRelationshipEdgeTypes}
              connectionMode={ConnectionMode.Loose}
              connectionLineType={ConnectionLineType.SmoothStep}
              onInit={(instance) => {
                flow.current = instance;
              }}
              onNodesChange={(changes) =>
                setFlowNodes((current) => applyNodeChanges(changes, current))
              }
              onNodeClick={(_, node) => {
                setSelectedId(node.id);
                setSelectedEdgeId(null);
              }}
              onNodeDoubleClick={(_, node) => {
                if (node.data.item.kind === "reference") openReference(node.data.item);
                if (node.data.item.kind === "storyboard") openBoard(node.data.item);
              }}
              onEdgeClick={(_, edge) => {
                setSelectedId(null);
                setSelectedEdgeId(edge.id);
              }}
              onPaneClick={() => {
                setSelectedId(null);
                setSelectedEdgeId(null);
              }}
              onNodeDrag={(_, node) => previewGroupMove(node.id, node.position)}
              onNodeDragStop={(_, node) => commitNodeMove(node.id, node.position)}
              onConnect={(connection) => {
                changeFromLatest((current) => {
                  const edge = connectedStoryboardEdge(
                    currentBoardId,
                    connection,
                    current.nodes,
                    current.edges,
                  );
                  return edge ? { ...current, edges: [...current.edges, edge] } : current;
                });
              }}
              nodesConnectable
              nodeDragThreshold={6}
              nodeClickDistance={6}
              snapToGrid
              snapGrid={[STORYBOARD_GRID_SIZE, STORYBOARD_GRID_SIZE]}
              defaultEdgeOptions={{ type: "smoothstep" }}
              aria-label={t("storyboardCanvasLabel")}
              fitView
              minZoom={0.08}
              maxZoom={2.2}
              deleteKeyCode={null}
            >
              <Background
                className="storyboard-board-grid"
                variant={BackgroundVariant.Lines}
                gap={STORYBOARD_GRID_SIZE}
                size={0.55}
                color="var(--line)"
              />
              {breadcrumbBoards.length > 0 && (
                <Panel position="top-left" className="storyboard-breadcrumb-panel">
                  <ScrollArea
                    as="nav"
                    axis="x"
                    gutter="auto"
                    surface="transparent"
                    className="storyboard-breadcrumbs"
                    aria-label={t("storyboardBreadcrumbLabel")}
                  >
                    {breadcrumbBoards.map(({ board, trailKey, trailLength }) => (
                      <Button
                        key={trailKey}
                        appearance="ghost"
                        size="compact"
                        disabled={trailLength === breadcrumbBoards.length}
                        onClick={() => {
                          setActiveBoardId(board.id);
                          setBoardTrail((trail) => trail.slice(0, trailLength));
                          setSelectedId(null);
                          setSelectedEdgeId(null);
                        }}
                      >
                        {board.title}
                      </Button>
                    ))}
                  </ScrollArea>
                </Panel>
              )}
              {selectedEdge && (
                <Panel position="top-right" className="graph-edge-inspector-panel">
                  <StoryboardEdgeInspector
                    edge={selectedEdge}
                    sourceLabel={storyboardNodeLabel(selectedEdgeSource)}
                    targetLabel={storyboardNodeLabel(selectedEdgeTarget)}
                    toggleConflict={toggleEdgeConflict}
                    reverseConflict={reverseEdgeConflict}
                    onLabelChange={(label) => patchEdge(selectedEdge.id, { label })}
                    onLineStyleChange={(lineStyle) => patchEdge(selectedEdge.id, { lineStyle })}
                    onColorChange={(color) => patchEdge(selectedEdge.id, { color })}
                    onDirectedChange={(directed) => {
                      if (toggleEdgeConflict) return;
                      patchEdge(selectedEdge.id, { directed });
                    }}
                    onReverse={() => {
                      if (reverseEdgeConflict) return;
                      patchEdge(selectedEdge.id, {
                        sourceNodeId: selectedEdge.targetNodeId,
                        targetNodeId: selectedEdge.sourceNodeId,
                      });
                    }}
                  />
                </Panel>
              )}
              <GraphViewportChrome<StoryboardFlowNode>
                minimapVisible={minimapVisible}
                onMinimapVisibleChange={setMinimapVisible}
                minimapProps={{
                  nodeColor: (node) => cardKindColor(node.data.cardKind),
                }}
              />
            </ReactFlow>
            {!activeNodes.length && (
              <EmptyState
                className="storyboard-empty-state"
                aria-label={t("storyboardEmptyTitle")}
                icon={<StickyNote />}
                title={t("storyboardEmptyTitle")}
                actions={
                  <Button appearance="primary" icon={<Plus />} onClick={() => addNote()}>
                    {t("storyboardAddNote")}
                  </Button>
                }
              >
                <p>{t("storyboardEmptyBody")}</p>
              </EmptyState>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
