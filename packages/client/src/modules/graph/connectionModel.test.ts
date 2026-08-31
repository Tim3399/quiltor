import { describe, expect, it } from "vitest";
import {
  GRAPH_CONNECTION_HANDLES,
  graphConnectionHandles,
  graphConnectionKey,
  graphConnectionKind,
} from "./connectionModel";

describe("shared graph connection model", () => {
  it("recognizes only the deliberate directed and neutral handle gestures", () => {
    expect(
      graphConnectionKind(GRAPH_CONNECTION_HANDLES.outgoing, GRAPH_CONNECTION_HANDLES.incoming),
    ).toBe("directed");
    expect(
      graphConnectionKind(
        GRAPH_CONNECTION_HANDLES.neutralTop,
        GRAPH_CONNECTION_HANDLES.neutralBottom,
      ),
    ).toBe("undirected");
    expect(
      graphConnectionKind(GRAPH_CONNECTION_HANDLES.incoming, GRAPH_CONNECTION_HANDLES.outgoing),
    ).toBeNull();
    expect(
      graphConnectionKind(GRAPH_CONNECTION_HANDLES.outgoing, GRAPH_CONNECTION_HANDLES.neutralTop),
    ).toBeNull();
    expect(graphConnectionKind(null, null)).toBeNull();
  });

  it("keeps directed identity ordered and undirected identity order-independent", () => {
    expect(graphConnectionKey("ada", "bela", true)).not.toBe(
      graphConnectionKey("bela", "ada", true),
    );
    expect(graphConnectionKey("ada", "bela", false)).toBe(graphConnectionKey("bela", "ada", false));
    expect(graphConnectionKey("ada", "bela", true)).not.toBe(
      graphConnectionKey("ada", "bela", false),
    );
  });

  it("uses directional handles without consulting canvas geometry", () => {
    expect(
      graphConnectionHandles(
        { sourceId: "missing-a", targetId: "missing-b", directed: true },
        [],
        48,
      ),
    ).toEqual({
      source: GRAPH_CONNECTION_HANDLES.outgoing,
      target: GRAPH_CONNECTION_HANDLES.incoming,
    });
  });

  it("routes vertical neutral connections outward and falls back safely", () => {
    const nodes = [
      { id: "top", x: 0, y: 0 },
      { id: "bottom", x: 0, y: 120 },
    ];

    expect(
      graphConnectionHandles({ sourceId: "top", targetId: "bottom", directed: false }, nodes, 48),
    ).toEqual({
      source: GRAPH_CONNECTION_HANDLES.neutralBottom,
      target: GRAPH_CONNECTION_HANDLES.neutralTop,
    });
    expect(
      graphConnectionHandles({ sourceId: "bottom", targetId: "top", directed: false }, nodes, 48),
    ).toEqual({
      source: GRAPH_CONNECTION_HANDLES.neutralTop,
      target: GRAPH_CONNECTION_HANDLES.neutralBottom,
    });
    expect(
      graphConnectionHandles({ sourceId: "missing", targetId: "top", directed: false }, nodes, 48),
    ).toEqual({
      source: GRAPH_CONNECTION_HANDLES.neutralBottom,
      target: GRAPH_CONNECTION_HANDLES.neutralTop,
    });
  });

  it("places near-horizontal neutral connections on the outward graph side", () => {
    const nodes = [
      { id: "top-left", x: 0, y: 0 },
      { id: "top-right", x: 200, y: 8 },
      { id: "bottom-left", x: 0, y: 200 },
      { id: "bottom-right", x: 200, y: 208 },
    ];

    expect(
      graphConnectionHandles(
        { sourceId: "top-left", targetId: "top-right", directed: false },
        nodes,
        48,
      ),
    ).toEqual({
      source: GRAPH_CONNECTION_HANDLES.neutralTop,
      target: GRAPH_CONNECTION_HANDLES.neutralTop,
    });
    expect(
      graphConnectionHandles(
        { sourceId: "bottom-left", targetId: "bottom-right", directed: false },
        nodes,
        48,
      ),
    ).toEqual({
      source: GRAPH_CONNECTION_HANDLES.neutralBottom,
      target: GRAPH_CONNECTION_HANDLES.neutralBottom,
    });
  });
});
