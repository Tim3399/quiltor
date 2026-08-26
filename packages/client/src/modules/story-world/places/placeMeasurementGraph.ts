import type { Edge } from "@xyflow/react";
import type { Translate } from "../../../i18n";
import type { FigureState } from "../model";
import {
  formatDistance,
  type IdentifiedMapPoint,
  mapDistancePair,
  nearestMapDistances,
} from "./placeMap";

export type PlaceMeasurementPoint = IdentifiedMapPoint & { name: string };

export function createPlaceMeasurementEdges({
  points,
  selection,
  scale,
  t,
}: {
  points: PlaceMeasurementPoint[];
  selection: string[];
  scale?: FigureState["mapScale"];
  t: Translate;
}): Edge[] {
  const pairs = new Map(nearestMapDistances(points).map((pair) => [pair.id, pair]));
  const from = points.find((point) => point.id === selection[0]);
  const to = points.find((point) => point.id === selection[1]);
  const targeted = from && to ? mapDistancePair(from, to) : null;
  if (targeted) pairs.set(targeted.id, targeted);

  const names = new Map(points.map((point) => [point.id, point.name]));
  return [...pairs.values()].map((pair) => {
    const distance = formatDistance(pair.distance, t, scale);
    return {
      id: pair.id,
      source: pair.from,
      target: pair.to,
      sourceHandle: "place-anchor",
      targetHandle: "place-anchor",
      type: "straight",
      label: distance,
      ariaLabel: t("distanceEdgeLabel", {
        from: names.get(pair.from) ?? pair.from,
        to: names.get(pair.to) ?? pair.to,
        distance,
      }),
      labelBgStyle: {
        fill: pair.id === targeted?.id ? "var(--selection-surface)" : "var(--edge-label-bg)",
        stroke: pair.id === targeted?.id ? "var(--selection-border)" : "var(--line)",
        strokeWidth: 1,
      },
      labelStyle: {
        fill: "var(--edge-label-text)",
        fontSize: 12,
        fontWeight: pair.id === targeted?.id ? 700 : 600,
      },
      labelBgPadding: [7, 4] as [number, number],
      labelBgBorderRadius: 6,
      selectable: false,
      focusable: false,
      className: pair.id === targeted?.id ? "distance-edge is-targeted" : "distance-edge",
    } satisfies Edge;
  });
}
