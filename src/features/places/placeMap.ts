export interface MapPoint { mapX: number; mapY: number }

export function mapDistance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(b.mapX - a.mapX, b.mapY - a.mapY);
}

export function formatDistance(distance: number, scale?: { unitsPer100px: number; unitLabel: string }): string {
  if (!scale) return `${Math.round(distance)} Einheiten (kein Maßstab gesetzt)`;
  const units = (distance / 100) * scale.unitsPer100px;
  const rounded = Math.round(units * 100) / 100;
  return `${rounded} ${scale.unitLabel}`;
}
