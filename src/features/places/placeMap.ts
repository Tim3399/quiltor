import type { MessageKey } from "../../language";

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

export function allMapDistances(points: IdentifiedMapPoint[]): MapDistancePair[] {
  const ordered = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const distances: MapDistancePair[] = [];
  for (let fromIndex = 0; fromIndex < ordered.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < ordered.length; toIndex += 1) {
      const from = ordered[fromIndex];
      const to = ordered[toIndex];
      distances.push({
        id: `distance:${encodeURIComponent(from.id)}:${encodeURIComponent(to.id)}`,
        from: from.id,
        to: to.id,
        distance: mapDistance(from, to),
      });
    }
  }
  return distances;
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
