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
      labelBgStyle: { fill: "var(--edge-label-bg)" },
      labelStyle: { fill: "var(--edge-label-text)" },
      labelBgPadding: [5, 3] as [number, number],
      labelBgBorderRadius: 4,
      selectable: false,
      focusable: false,
      className: pair.id === targeted?.id ? "distance-edge is-targeted" : "distance-edge",
    } satisfies Edge;
  });
}
