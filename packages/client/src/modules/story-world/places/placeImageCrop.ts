/**
 * How a picture sits inside its frame.
 *
 * A map frame keeps the picture's own proportions, so at rest the picture fills
 * it exactly. Enlarging crops into it around a chosen point -- which is how an
 * author shows the quarter of a map that matters instead of the whole sheet.
 *
 * The same point decides which part a collapsed card wears in its band, so the
 * telling detail is chosen once and serves both views.
 */

import type { FigureNode } from "../model";

export interface ImageCrop {
  /** One shows the whole picture; above that it is enlarged and cropped. */
  zoom: number;
  /** The point the enlargement grows around, as a fraction of the picture. */
  u: number;
  v: number;
}

/** Below one the frame would show paper the picture does not cover. */
export const IMAGE_ZOOM_RANGE = { min: 1, max: 8 } as const;

/** Coarse enough to feel like a step, fine enough to land where you meant. */
const ZOOM_STEP = 1.15;

export const DEFAULT_CROP: ImageCrop = { zoom: 1, u: 0.5, v: 0.5 };

export function cropOf(place: FigureNode): ImageCrop {
  return {
    zoom: clamp(numberOr(place.mapImageZoom, 1), IMAGE_ZOOM_RANGE.min, IMAGE_ZOOM_RANGE.max),
    u: clamp(numberOr(place.mapImageU, 0.5), 0, 1),
    v: clamp(numberOr(place.mapImageV, 0.5), 0, 1),
  };
}

/** `crop` zoomed a step in (`direction` above zero) or out. */
export function zoomedCrop(crop: ImageCrop, direction: number): ImageCrop {
  const zoom = clamp(
    direction > 0 ? crop.zoom * ZOOM_STEP : crop.zoom / ZOOM_STEP,
    IMAGE_ZOOM_RANGE.min,
    IMAGE_ZOOM_RANGE.max,
  );
  // All the way out is the whole picture again, and centred is the only honest
  // place to leave it: an off-centre point means nothing once nothing is cropped.
  return zoom === IMAGE_ZOOM_RANGE.min ? { ...DEFAULT_CROP } : { ...crop, zoom };
}

/**
 * `crop` moved by a drag given as a fraction of the frame.
 *
 * The picture follows the pointer, so the point the enlargement grows around
 * travels the other way -- and by less, the further in the picture is zoomed,
 * because a frame-width of movement covers less of a picture that has been
 * enlarged.
 */
export function movedCrop(crop: ImageCrop, delta: { x: number; y: number }): ImageCrop {
  if (crop.zoom <= IMAGE_ZOOM_RANGE.min) return crop;
  const reach = crop.zoom / (crop.zoom - 1);
  return {
    zoom: crop.zoom,
    u: clamp(crop.u - delta.x * reach, 0, 1),
    v: clamp(crop.v - delta.y * reach, 0, 1),
  };
}

/** What a place carries for its picture, or nothing when it is untouched. */
export function cropPatch(crop: ImageCrop): Partial<FigureNode> {
  if (crop.zoom <= IMAGE_ZOOM_RANGE.min) {
    return { mapImageZoom: undefined, mapImageU: undefined, mapImageV: undefined };
  }
  return { mapImageZoom: crop.zoom, mapImageU: crop.u, mapImageV: crop.v };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
