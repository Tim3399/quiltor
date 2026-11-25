/**
 * How much of the canvas's lower edge the minimap covers, so a fit keeps what it frames out
 * from under it (T-379). The values mirror GraphViewportChrome.css: the minimap's block size
 * and scale per width, the inset it stands at and the gap the other overlays keep from it.
 * Below 720px, or on a touch screen, the minimap steps aside and nothing is reserved.
 */
const MINIMAP_INSET = 14;
const MINIMAP_GAP = 10;

export function minimapFitReserve(
  matches: (query: string) => boolean = (query) =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
): number {
  if (matches("(max-width: 719px), (pointer: coarse)")) return 0;
  const block = matches("(max-width: 820px)") ? 105 * 0.7 : 150;
  return Math.ceil(block + MINIMAP_INSET + MINIMAP_GAP);
}
