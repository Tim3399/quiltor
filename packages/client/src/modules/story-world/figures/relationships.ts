import type { MessageKey } from "../../../i18n";
import {
  graphConnectionHandles,
  graphConnectionKey,
  graphConnectionKind,
  graphEdgeLineStyle,
  graphRelationshipKind,
} from "../../graph";
import type {
  FigureEdge,
  FigureKind,
  FigureNode,
  RelationshipVersion,
  TimelineMoment,
} from "../model";

export type SemanticZoomTier = "detail" | "compact" | "overview";

export const GRID_SIZE = 48;

function relationshipColor(edge: FigureEdge): NonNullable<FigureEdge["color"]> {
  return edge.color ?? (edge.style === "gold" ? "gold" : "auto");
}

export function kindLabel(kind: FigureKind | undefined, t: (key: MessageKey) => string): string {
  if (kind === "ort") return t("place");
  if (kind === "konzept") return t("concept");
  if (kind === "tier") return t("animal");
  if (kind === "organisation") return t("organisation");
  if (kind === "objekt") return t("object");
  return t("figure");
}

export function semanticZoomTier(zoom: number): SemanticZoomTier {
  if (zoom < 0.34) return "overview";
  if (zoom < 0.68) return "compact";
  return "detail";
}

export function alignNodesToGrid(nodes: FigureNode[]) {
  return nodes.map((node) => ({
    ...node,
    x: Math.round(node.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(node.y / GRID_SIZE) * GRID_SIZE,
  }));
}

export function resolveRelationship(
  edge: FigureEdge,
  timeline: TimelineMoment[],
  activeId: string | null,
): FigureEdge & { active: boolean } {
  const base = { ...edge, active: edge.active !== false };
  if (!activeId) return base;
  const activeIndex = timeline.findIndex((moment) => moment.id === activeId);
  const versions = (edge.versions || [])
    .filter((item) => {
      const index = timeline.findIndex((moment) => moment.id === item.momentId);
      return index >= 0 && index <= activeIndex;
    })
    .sort(
      (a, b) =>
        timeline.findIndex((moment) => moment.id === a.momentId) -
        timeline.findIndex((moment) => moment.id === b.momentId),
    );
  return versions.reduce<FigureEdge & { active: boolean }>(
    (current, version) => ({ ...current, ...version, id: edge.id, active: version.active }),
    base,
  );
}

export function resolveRelationshipOverview(
  edge: FigureEdge,
  timeline: TimelineMoment[],
): FigureEdge & { active: boolean } {
  const ordered = [...(edge.versions || [])].sort(
    (a, b) =>
      timeline.findIndex((moment) => moment.id === a.momentId) -
      timeline.findIndex((moment) => moment.id === b.momentId),
  );
  const labels = [
    edge.label,
    ...ordered.filter((version) => version.active).map((version) => version.label),
  ].filter((label): label is string => !!label?.trim());
  const distinctLabels = labels.filter((label, index) => labels.indexOf(label) === index);
  const latestActive = [...ordered].reverse().find((version) => version.active);
  return {
    ...edge,
    ...(latestActive || {}),
    id: edge.id,
    from: edge.from,
    to: edge.to,
    label: distinctLabels.join(" → "),
    active: edge.active !== false || ordered.some((version) => version.active),
  };
}

export function patchRelationship(
  edge: FigureEdge,
  timeline: TimelineMoment[],
  activeId: string | null,
  patch: Partial<FigureEdge>,
): FigureEdge {
  if (!activeId) {
    const next = { ...edge, ...patch };
    if (
      patch.lineStyle !== undefined ||
      patch.relationshipKind !== undefined ||
      patch.color !== undefined
    ) {
      next.lineStyle = patch.lineStyle ?? graphEdgeLineStyle(edge);
      next.relationshipKind = patch.relationshipKind ?? graphRelationshipKind(edge);
      next.color = patch.color ?? relationshipColor(edge);
      delete next.style;
    }
    return next;
  }
  const current = resolveRelationship(edge, timeline, activeId);
  const version: RelationshipVersion = {
    momentId: activeId,
    from: current.from,
    to: current.to,
    label: current.label,
    lineStyle: graphEdgeLineStyle(current),
    relationshipKind: graphRelationshipKind(current),
    gerichtet: current.gerichtet,
    color: relationshipColor(current),
    active: patch.active ?? current.active,
  };
  if (patch.from !== undefined) version.from = patch.from;
  if (patch.to !== undefined) version.to = patch.to;
  if (patch.label !== undefined) {
    if (patch.label.trim()) version.label = patch.label;
    else delete version.label;
  }
  if (patch.style !== undefined) version.style = patch.style;
  if (patch.lineStyle !== undefined) version.lineStyle = patch.lineStyle;
  if (patch.relationshipKind !== undefined) version.relationshipKind = patch.relationshipKind;
  if (patch.gerichtet !== undefined) version.gerichtet = patch.gerichtet;
  if (patch.color !== undefined) version.color = patch.color;
  return {
    ...edge,
    versions: [...(edge.versions || []).filter((item) => item.momentId !== activeId), version],
  };
}

export function relationshipLabelEditor(
  edge: FigureEdge,
  timeline: TimelineMoment[],
  activeId: string | null,
) {
  if (!activeId) return { value: edge.label || "", inherited: "" };
  const version = edge.versions?.find((item) => item.momentId === activeId);
  const index = timeline.findIndex((moment) => moment.id === activeId);
  const inherited =
    index > 0
      ? resolveRelationship(edge, timeline, timeline[index - 1].id).label || ""
      : edge.label || "";
  return { value: version?.label || "", inherited: version?.label ? "" : inherited };
}

export function figureIsDeceased(
  figure: FigureNode,
  timeline: TimelineMoment[],
  activeId: string | null,
) {
  if (!figure.diedMomentId || !activeId) return false;
  const death = timeline.findIndex((moment) => moment.id === figure.diedMomentId);
  const active = timeline.findIndex((moment) => moment.id === activeId);
  return death >= 0 && active >= death;
}

export function connectionKind(
  sourceHandle?: string | null,
  targetHandle?: string | null,
): "directed" | "undirected" | null {
  return graphConnectionKind(sourceHandle, targetHandle);
}

export function relationshipKey(from: string, to: string, directed: boolean) {
  return graphConnectionKey(from, to, directed);
}

export function relationshipConflicts(
  edges: FigureEdge[],
  timeline: TimelineMoment[],
  activeId: string | null,
  edgeId: string,
  candidate: Pick<FigureEdge, "from" | "to" | "gerichtet">,
) {
  const candidateKey = relationshipKey(candidate.from, candidate.to, !!candidate.gerichtet);
  return edges.some((edge) => {
    if (edge.id === edgeId) return false;
    const resolved = resolveRelationship(edge, timeline, activeId);
    return (
      resolved.active &&
      relationshipKey(resolved.from, resolved.to, !!resolved.gerichtet) === candidateKey
    );
  });
}

export function relationshipHandles(edge: FigureEdge, nodes: FigureNode[]) {
  const handles = graphConnectionHandles(
    {
      sourceId: edge.from,
      targetId: edge.to,
      directed: !!edge.gerichtet,
    },
    nodes,
    GRID_SIZE,
  );
  return { from: handles.source, to: handles.target };
}
