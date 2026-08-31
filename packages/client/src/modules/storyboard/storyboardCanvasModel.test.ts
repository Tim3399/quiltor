import { describe, expect, it } from "vitest";
import type { WorldReferenceCandidate } from "../world-references";
import type { StoryboardGroupNode, StoryboardNode, StoryboardReferenceNode } from "./model";
import {
  candidateForDragValue,
  candidateNode,
  connectedStoryboardEdge,
  groupNode,
  moveStoryboardNodeWithGroupMembers,
  noteNode,
  referenceDragValue,
  storyboardCardKind,
  storyboardFlowEdge,
  storyboardFlowNode,
  storyboardGroupMemberIds,
  updateStoryboardNodeNote,
} from "./storyboardCanvasModel";

const entity: WorldReferenceCandidate = {
  id: "entity:ada",
  target: { kind: "entity", id: "ada" },
  label: "Ada",
  detail: "Figur",
  keywords: [],
  workspace: "figures",
  cardKind: "person",
};

const board: WorldReferenceCandidate = {
  id: "storyboard:second",
  target: { kind: "storyboard", id: "second" },
  label: "Zweiter Akt",
  detail: "Storyboard",
  keywords: [],
  workspace: "storyboard",
  cardKind: "storyboard",
};

const group: StoryboardGroupNode = {
  id: "group",
  boardId: "main",
  kind: "group",
  x: 100,
  y: 100,
  width: 500,
  height: 360,
  label: "Akt eins",
};

const groupedNodes: StoryboardNode[] = [
  group,
  {
    id: "inside",
    boardId: "main",
    kind: "note",
    x: 120,
    y: 130,
    width: 100,
    height: 80,
    text: "Innen",
  },
  {
    id: "on-boundary",
    boardId: "main",
    kind: "reference",
    x: 360,
    y: 250,
    target: { kind: "entity", id: "ada" },
  },
  {
    id: "partly-outside",
    boardId: "main",
    kind: "note",
    x: 550,
    y: 130,
    width: 100,
    height: 80,
    text: "Nur teilweise innen",
  },
  {
    id: "nested-group",
    boardId: "main",
    kind: "group",
    x: 140,
    y: 140,
    width: 120,
    height: 100,
    label: "Andere Gruppe",
  },
  {
    id: "nested-child",
    boardId: "main",
    kind: "note",
    x: 160,
    y: 160,
    width: 40,
    height: 40,
    text: "In der Untergruppe",
  },
  {
    id: "other-board",
    boardId: "other",
    kind: "note",
    x: 120,
    y: 130,
    width: 100,
    height: 80,
    text: "Anderes Board",
  },
];

describe("storyboard canvas model", () => {
  it.each(["person", "tier", "ort", "organisation", "objekt", "konzept"] as const)(
    "resolves a live %s world kind instead of persisting a generic reference color",
    (cardKind) => {
      const target =
        cardKind === "ort"
          ? ({ kind: "place", id: "world-item" } as const)
          : ({ kind: "entity", id: "world-item" } as const);
      const reference: StoryboardNode = {
        id: "reference",
        boardId: "main",
        kind: "reference",
        x: 0,
        y: 0,
        target,
      };
      const candidate: WorldReferenceCandidate = {
        id: `${target.kind}:${target.id}`,
        target,
        label: "World item",
        detail: "",
        keywords: [],
        workspace: cardKind === "ort" ? "places" : "figures",
        cardKind,
      };

      expect(storyboardCardKind(reference, [candidate])).toBe(cardKind);
    },
  );

  it("uses semantic fallbacks and never pretends an unresolved entity is a person", () => {
    const reference = (target: StoryboardReferenceNode["target"]): StoryboardNode => ({
      id: `reference-${target.kind}`,
      boardId: "main",
      kind: "reference",
      x: 0,
      y: 0,
      target,
    });

    expect(storyboardCardKind(reference({ kind: "entity", id: "missing" }))).toBe("reference");
    expect(storyboardCardKind(reference({ kind: "place", id: "missing" }))).toBe("ort");
    expect(storyboardCardKind(reference({ kind: "chapter", id: "missing" }))).toBe("chapter");
    expect(storyboardCardKind(reference({ kind: "timeline", id: "missing" }))).toBe("timeline");
    expect(storyboardCardKind(noteNode("main", { x: 0, y: 0 }, []))).toBe("note");
    expect(storyboardCardKind(group)).toBe("group");
    expect(
      storyboardCardKind({
        id: "board-reference",
        boardId: "main",
        kind: "storyboard",
        x: 0,
        y: 0,
        target: { kind: "storyboard", id: "second" },
      }),
    ).toBe("storyboard");
  });
  it("creates author-owned empty note cards and globally unique node ids", () => {
    const first = noteNode("main", { x: 20, y: 40 }, []);
    const second = groupNode("other", { x: 60, y: 80 }, [first.id], "Gruppe");

    expect(first).toMatchObject({ boardId: "main", kind: "note", text: "" });
    expect(first.noteReferences).toEqual([]);
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({
      boardId: "other",
      kind: "group",
      label: "Gruppe",
      text: "",
      noteReferences: [],
    });
  });

  it("maps world and board candidates onto their lossless node kinds", () => {
    expect(candidateNode("main", { x: 0, y: 0 }, [], entity)).toMatchObject({
      kind: "reference",
      target: entity.target,
      label: "Ada",
      text: "",
      noteReferences: [],
    });
    expect(candidateNode("main", { x: 0, y: 0 }, [], board)).toMatchObject({
      kind: "storyboard",
      target: board.target,
      label: "Zweiter Akt",
      text: "",
      noteReferences: [],
    });
  });

  it("creates directed and undirected connections from their deliberate handles", () => {
    const nodes = [
      noteNode("main", { x: 0, y: 0 }, []),
      noteNode("main", { x: 100, y: 0 }, []),
      noteNode("other", { x: 0, y: 0 }, []),
    ];
    const directedConnection = {
      source: nodes[0].id,
      target: nodes[1].id,
      sourceHandle: "out",
      targetHandle: "in",
    };
    const directed = connectedStoryboardEdge("main", directedConnection, nodes, []);

    expect(directed).toMatchObject({
      boardId: "main",
      sourceNodeId: nodes[0].id,
      targetNodeId: nodes[1].id,
      directed: true,
    });

    const undirectedConnection = {
      ...directedConnection,
      sourceHandle: "neutral-bottom",
      targetHandle: "neutral-top",
    };
    const undirected = connectedStoryboardEdge(
      "main",
      undirectedConnection,
      nodes,
      directed ? [directed] : [],
    );
    expect(undirected).toMatchObject({
      sourceNodeId: nodes[0].id,
      targetNodeId: nodes[1].id,
      directed: false,
    });

    expect(
      connectedStoryboardEdge("main", directedConnection, nodes, directed ? [directed] : []),
    ).toBeNull();
    expect(
      connectedStoryboardEdge(
        "main",
        {
          ...directedConnection,
          source: nodes[1].id,
          target: nodes[0].id,
        },
        nodes,
        directed ? [directed] : [],
      ),
    ).toMatchObject({
      sourceNodeId: nodes[1].id,
      targetNodeId: nodes[0].id,
      directed: true,
    });
    expect(
      connectedStoryboardEdge(
        "main",
        {
          ...undirectedConnection,
          source: nodes[1].id,
          target: nodes[0].id,
        },
        nodes,
        undirected ? [undirected] : [],
      ),
    ).toBeNull();
    expect(
      connectedStoryboardEdge(
        "main",
        {
          source: nodes[0].id,
          target: nodes[2].id,
          sourceHandle: "out",
          targetHandle: "in",
        },
        nodes,
        [],
      ),
    ).toBeNull();
    expect(
      connectedStoryboardEdge(
        "main",
        {
          source: nodes[0].id,
          target: nodes[0].id,
          sourceHandle: "out",
          targetHandle: "in",
        },
        nodes,
        [],
      ),
    ).toBeNull();
    expect(
      connectedStoryboardEdge(
        "main",
        {
          ...directedConnection,
          sourceHandle: "out",
          targetHandle: "neutral-top",
        },
        nodes,
        [],
      ),
    ).toBeNull();
  });

  it("projects labels, smooth-step geometry, direction classes, handles, and arrow markers", () => {
    const nodes: StoryboardNode[] = [
      { ...noteNode("main", { x: 0, y: 0 }, []), id: "top" },
      { ...noteNode("main", { x: 0, y: 160 }, []), id: "bottom" },
    ];
    const base = {
      id: "edge",
      boardId: "main",
      sourceNodeId: "top",
      targetNodeId: "bottom",
      label: "Auslöser",
    };

    expect(storyboardFlowEdge(base, nodes)).toMatchObject({
      type: "graphRelationship",
      sourceHandle: "neutral-bottom",
      targetHandle: "neutral-top",
      label: "Auslöser",
      ariaLabel: "top ↔ bottom — Auslöser",
      className:
        "graph-relationship-edge edge-line-solid edge-solid edge-undirected edge-color-auto",
      labelBgStyle: { fill: "var(--graph-edge-label-bg)" },
      labelStyle: { fill: "var(--graph-edge-label-text)" },
      markerEnd: undefined,
    });
    expect(
      storyboardFlowEdge({ ...base, directed: true, color: "rose" as const }, nodes),
    ).toMatchObject({
      type: "graphRelationship",
      sourceHandle: "out",
      targetHandle: "in",
      label: "Auslöser",
      ariaLabel: "top → bottom — Auslöser",
      className: "graph-relationship-edge edge-line-solid edge-solid edge-directed edge-color-rose",
      markerEnd: {
        type: "arrowclosed",
        color: "var(--graph-edge-color-rose)",
      },
    });
  });

  it("round-trips the stable world-reference drag value", () => {
    const value = referenceDragValue(entity);

    expect(value).toBe("entity:ada");
    expect(candidateForDragValue([board, entity], value)).toBe(entity);
    expect(candidateForDragValue([entity], "entity:missing")).toBeUndefined();
  });

  it("lets React Flow drag a card from every non-interactive surface", () => {
    const flowNode = storyboardFlowNode(noteNode("main", { x: 20, y: 40 }, []), {
      onPatch: () => undefined,
      onNoteChange: () => undefined,
      onOpenReference: () => undefined,
      onOpenBoard: () => undefined,
    });

    expect(flowNode.dragHandle).toBeUndefined();
  });

  it("updates note text and references on every node kind without touching its identity", () => {
    const noteReference = {
      id: "ref-ada",
      target: { kind: "entity" as const, id: "ada" },
      from: 0,
      to: 3,
      surface: "Ada",
    };
    const nodes: StoryboardNode[] = [
      noteNode("main", { x: 0, y: 0 }, []),
      candidateNode("main", { x: 20, y: 0 }, [], entity),
      candidateNode("main", { x: 40, y: 0 }, [], board),
      groupNode("main", { x: 60, y: 0 }, [], "Gruppe"),
    ];

    for (const node of nodes) {
      const updated = updateStoryboardNodeNote(nodes, node.id, "Ada", [noteReference]);
      expect(updated.find((candidate) => candidate.id === node.id)).toMatchObject({
        id: node.id,
        kind: node.kind,
        text: "Ada",
        noteReferences: [noteReference],
      });
      expect(updated.filter((candidate) => candidate.id !== node.id)).toEqual(
        nodes.filter((candidate) => candidate.id !== node.id),
      );
    }

    expect(updateStoryboardNodeNote(nodes, "missing", "Ada", [])).toBe(nodes);
  });

  it("treats every same-board node fully inside a group as a member", () => {
    expect(storyboardGroupMemberIds(group, groupedNodes)).toEqual([
      "inside",
      "on-boundary",
      "nested-group",
      "nested-child",
    ]);
  });

  it("keeps explicit legacy dimensions consistent for rendering and group membership", () => {
    const legacyGroup: StoryboardGroupNode = {
      id: "legacy-group",
      boardId: "main",
      kind: "group",
      x: 0,
      y: 0,
      width: 300,
      height: 180,
      label: "Legacy",
    };
    const legacyReference: StoryboardNode = {
      id: "legacy-reference",
      boardId: "main",
      kind: "reference",
      x: 20,
      y: 40,
      width: 240,
      height: 120,
      target: { kind: "entity", id: "ada" },
    };
    const context = {
      onPatch: () => undefined,
      onNoteChange: () => undefined,
      onOpenReference: () => undefined,
      onOpenBoard: () => undefined,
    };

    expect(storyboardGroupMemberIds(legacyGroup, [legacyGroup, legacyReference])).toEqual([
      legacyReference.id,
    ]);
    expect(storyboardFlowNode(legacyReference, context).style).toMatchObject({
      width: 240,
      height: 120,
    });

    const sizeLessReference: StoryboardNode = {
      id: "default-reference",
      boardId: "main",
      kind: "reference",
      x: 20,
      y: 40,
      target: { kind: "entity", id: "ada" },
    };
    expect(storyboardFlowNode(sizeLessReference, context).style).toMatchObject({
      width: 240,
      height: 210,
    });
    expect(storyboardGroupMemberIds(legacyGroup, [legacyGroup, sizeLessReference])).toEqual([]);
  });

  it("moves a group and all geometric members by one shared delta", () => {
    const moved = moveStoryboardNodeWithGroupMembers(groupedNodes, group.id, { x: 160, y: 70 });
    const position = (id: string) => {
      const node = moved.find((candidate) => candidate.id === id);
      return node ? { x: node.x, y: node.y } : undefined;
    };

    expect(moved).not.toBe(groupedNodes);
    expect(position("group")).toEqual({ x: 160, y: 70 });
    expect(position("inside")).toEqual({ x: 180, y: 100 });
    expect(position("on-boundary")).toEqual({ x: 420, y: 220 });
    expect(position("partly-outside")).toEqual({ x: 550, y: 130 });
    expect(position("nested-group")).toEqual({ x: 200, y: 110 });
    expect(position("nested-child")).toEqual({ x: 220, y: 130 });
    expect(position("other-board")).toEqual({ x: 120, y: 130 });
    expect(groupedNodes[0]).toMatchObject({ x: 100, y: 100 });
  });

  it("moves a nested group's contents when that nested group moves independently", () => {
    const moved = moveStoryboardNodeWithGroupMembers(groupedNodes, "nested-group", {
      x: 180,
      y: 160,
    });
    const position = (id: string) => {
      const node = moved.find((candidate) => candidate.id === id);
      return node ? { x: node.x, y: node.y } : undefined;
    };

    expect(position("group")).toEqual({ x: 100, y: 100 });
    expect(position("nested-group")).toEqual({ x: 180, y: 160 });
    expect(position("nested-child")).toEqual({ x: 200, y: 180 });
    expect(position("inside")).toEqual({ x: 120, y: 130 });
  });
});
