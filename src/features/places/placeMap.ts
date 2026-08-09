import type { MessageKey } from '../../language';

export interface MapPoint { mapX: number; mapY: number }

export function mapDistance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(b.mapX - a.mapX, b.mapY - a.mapY);
}

export function formatDistance(distance: number, t: (key: MessageKey) => string, scale?: { unitsPer100px: number; unitLabel: string }): string {
  if (!scale) return t('unitsNoScale').replace('{n}', String(Math.round(distance)));
  const units = (distance / 100) * scale.unitsPer100px;
  const rounded = Math.round(units * 100) / 100;
  return `${rounded} ${scale.unitLabel}`;
}
