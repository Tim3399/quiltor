import type { MessageKey } from "../../../i18n";

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
