/**
 * The zoom a board's cards are sized for, held outside React state (T-372).
 *
 * The board reads its tier from it and the surface writes the cards' zoom variables from it,
 * so the two can never disagree. A zoom step inside a tier therefore renders nothing: the
 * surface listens and sets its CSS variables itself.
 *
 * It is only ever set from the board's onInit and onMove, never from React Flow's store: the
 * first fit of the view does not move the board, and the values have to be the ones the board
 * used before -- the zoom as React Flow reports it on init, rounded to hundredths on a move.
 */
export interface BoardZoom {
  /** 1 until the board reports its first zoom, as the board's state started out. */
  readonly current: number;
  set(zoom: number): void;
  subscribe(listener: (zoom: number) => void): () => void;
}

export function createBoardZoom(): BoardZoom {
  const listeners = new Set<(zoom: number) => void>();
  const zoom = {
    current: 1,
    set(next: number) {
      if (next === zoom.current) return;
      zoom.current = next;
      for (const listener of listeners) listener(next);
    },
    subscribe(listener: (zoom: number) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return zoom;
}

/** The zoom of a move, as the board keeps it: rounded to hundredths. */
export function roundedBoardZoom(zoom: number): number {
  return Math.round(zoom * 100) / 100;
}
