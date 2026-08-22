import type {
  FigureEdge,
  FigureKind,
  FigureNode,
  RelationshipVersion,
  TimelineMoment,
} from "../model";
import type { MessageKey } from "../../../i18n";

export type SemanticZoomTier = "detail" | "compact" | "overview";

export const GRID_SIZE = 48;

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
  if (!activeId) return { ...edge, ...patch };
  const current = resolveRelationship(edge, timeline, activeId);
  const version: RelationshipVersion = {
    momentId: activeId,
    from: current.from,
    to: current.to,
    label: current.label,
    style: current.style,
    gerichtet: current.gerichtet,
    active: patch.active ?? current.active,
  };
  if (patch.from !== undefined) version.from = patch.from;
  if (patch.to !== undefined) version.to = patch.to;
  if (patch.label !== undefined) {
    if (patch.label.trim()) version.label = patch.label;
    else delete version.label;
  }
  if (patch.style !== undefined) version.style = patch.style;
  if (patch.gerichtet !== undefined) version.gerichtet = patch.gerichtet;
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
  if (sourceHandle === "out" && targetHandle === "in") return "directed";
  if (sourceHandle?.startsWith("neutral-") && targetHandle?.startsWith("neutral-"))
    return "undirected";
  return null;
}

export function relationshipKey(from: string, to: string, directed: boolean) {
  return directed ? `directed:${from}:${to}` : `undirected:${[from, to].sort().join(":")}`;
}

export function relationshipHandles(edge: FigureEdge, nodes: FigureNode[]) {
  if (edge.gerichtet) return { from: "out", to: "in" };
  const from = nodes.find((node) => node.id === edge.from),
    to = nodes.find((node) => node.id === edge.to);
  if (!from || !to) return { from: "neutral-bottom", to: "neutral-top" };
  const verticalDistance = to.y - from.y;
  if (Math.abs(verticalDistance) >= GRID_SIZE)
    return verticalDistance > 0
      ? { from: "neutral-bottom", to: "neutral-top" }
      : { from: "neutral-top", to: "neutral-bottom" };
  const graphCenterY = nodes.reduce((sum, node) => sum + node.y, 0) / Math.max(nodes.length, 1);
  const pairCenterY = (from.y + to.y) / 2;
  const handle = pairCenterY <= graphCenterY ? "neutral-top" : "neutral-bottom";
  return { from: handle, to: handle };
}
