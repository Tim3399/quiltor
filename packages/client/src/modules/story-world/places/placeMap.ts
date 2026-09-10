import type { MessageKey } from "../../../i18n";
import type { MapScale } from "../model";

/** The physical distance between two adjacent grid lines, when a scale exists. */
export function physicalGridDistance(
  scale: MapScale | undefined,
  gridSize: number,
): number | undefined {
  if (
    !scale ||
    !Number.isFinite(scale.unitsPer100px) ||
    scale.unitsPer100px <= 0 ||
    !Number.isFinite(gridSize) ||
    gridSize <= 0
  )
    return undefined;
  return (gridSize / 100) * scale.unitsPer100px;
}

/** A real 1/2/5 distance whose projected length stays near the requested screen width. */
export function mapScaleBar(
  scale: MapScale | undefined,
  zoom: number,
  targetWidth = 110,
): { distance: number; width: number } | undefined {
  const unitsPerPixel = physicalGridDistance(scale, 1);
  if (
    !unitsPerPixel ||
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    !Number.isFinite(targetWidth) ||
    targetWidth <= 0
  )
    return undefined;
  const targetDistance = (targetWidth / zoom) * unitsPerPixel;
  if (!Number.isFinite(targetDistance) || targetDistance <= 0) return undefined;
  const power = 10 ** Math.floor(Math.log10(targetDistance));
  const distance = [1, 2, 5, 10]
    .map((factor) => factor * power)
    .reduce((best, candidate) =>
      Math.abs(Math.log(candidate / targetDistance)) < Math.abs(Math.log(best / targetDistance))
        ? candidate
        : best,
    );
  const width = (distance / unitsPerPixel) * zoom;
  return Number.isFinite(width) && width > 0 ? { distance, width } : undefined;
}

export interface MapPoint {
  mapX: number;
  mapY: number;
}

export interface IdentifiedMapPoint extends MapPoint {
  id: string;
}

export interface MapDistancePair {
  id: string;
  from: string;
  to: string;
  distance: number;
}

export function mapDistance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(b.mapX - a.mapX, b.mapY - a.mapY);
}

export function mapDistancePair(
  first: IdentifiedMapPoint,
  second: IdentifiedMapPoint,
): MapDistancePair {
  const [from, to] = first.id.localeCompare(second.id) <= 0 ? [first, second] : [second, first];
  return {
    id: `distance:${encodeURIComponent(from.id)}:${encodeURIComponent(to.id)}`,
    from: from.id,
    to: to.id,
    distance: mapDistance(from, to),
  };
}

export function allMapDistances(points: IdentifiedMapPoint[]): MapDistancePair[] {
  const ordered = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const distances: MapDistancePair[] = [];
  for (let fromIndex = 0; fromIndex < ordered.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < ordered.length; toIndex += 1) {
      distances.push(mapDistancePair(ordered[fromIndex], ordered[toIndex]));
    }
  }
  return distances;
}

export function nearestMapDistances(
  points: IdentifiedMapPoint[],
  neighboursPerPlace = 3,
): MapDistancePair[] {
  const limit = Math.max(0, Math.floor(neighboursPerPlace));
  if (!limit || points.length < 2) return [];

  const ordered = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const distances = new Map<string, MapDistancePair>();
  for (const from of ordered) {
    const nearest = ordered
      .filter((candidate) => candidate.id !== from.id)
      .map((to) => ({ to, pair: mapDistancePair(from, to) }))
      .sort((a, b) => a.pair.distance - b.pair.distance || a.to.id.localeCompare(b.to.id))
      .slice(0, limit);
    for (const { pair } of nearest) distances.set(pair.id, pair);
  }
  return [...distances.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * What a hundred pixels mean here, in one phrase.
 *
 * Said where the level is named rather than only where a distance is drawn:
 * two-stage scales raise the question the moment they exist, and the answer
 * belongs beside the thing that decides it.
 */
export function formatScale(
  scale: { unitsPer100px: number; unitLabel: string } | undefined,
  t: (key: MessageKey) => string,
): string {
  if (!scale) return "";
  return `${scale.unitsPer100px} ${scale.unitLabel} ${t("perHundredPx")}`;
}

export function formatDistance(
  distance: number,
  t: (key: MessageKey) => string,
  scale?: { unitsPer100px: number; unitLabel: string },
): string {
  if (!scale) return t("unitsNoScale").replace("{n}", String(Math.round(distance)));
  const units = (distance / 100) * scale.unitsPer100px;
  const rounded = Math.round(units * 100) / 100;
  return `${rounded} ${scale.unitLabel}`;
}
