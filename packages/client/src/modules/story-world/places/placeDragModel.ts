export interface DragClientPoint {
  x: number;
  y: number;
}

/** The pointer that ended or currently drives a React Flow mouse/touch drag. */
export function dragClientPoint(event: MouseEvent | TouchEvent): DragClientPoint | undefined {
  if ("touches" in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }
  return Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
    ? { x: event.clientX, y: event.clientY }
    : undefined;
}

/** A card rectangle whose semantic anchor is exactly the pointer, independent of grab offset. */
export function cardPositionAtPointer(
  pointer: DragClientPoint,
  size?: { width?: number; height?: number },
): DragClientPoint {
  return {
    x: pointer.x - (size?.width ?? 0) / 2,
    y: pointer.y - (size?.height ?? 0) / 2,
  };
}

export function placeDropFrame({
  pointer,
  position,
  size,
  anchored,
  pin,
}: {
  pointer?: DragClientPoint;
  position: DragClientPoint;
  size?: { width?: number; height?: number };
  anchored: boolean;
  pin: boolean;
}): { position: DragClientPoint; size?: { width?: number; height?: number } } {
  if (pin) return { position: pointer ?? position };
  if (pointer) return { position: cardPositionAtPointer(pointer, size), size };
  return {
    position: anchored
      ? {
          x: position.x - (size?.width ?? 0) / 2,
          y: position.y - (size?.height ?? 0) / 2,
        }
      : position,
    size,
  };
}
