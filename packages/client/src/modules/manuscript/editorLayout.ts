const EDITOR_PAGE_WIDTH = 760;
const EDITOR_PAGE_GUTTER = 32;

/**
 * Keep the page centred in the whole workspace while side panels use the otherwise empty
 * margins. When the wider panel would come closer than the normal page gutter, there is no
 * longer enough room and the grid is allowed to reflow instead.
 */
export function editorBalanceOffset(
  layoutWidth: number,
  leftPanelWidth: number,
  rightPanelWidth: number,
): number | null {
  const requiredWidth =
    EDITOR_PAGE_WIDTH + EDITOR_PAGE_GUTTER * 2 + Math.max(leftPanelWidth, rightPanelWidth) * 2;
  if (layoutWidth < requiredWidth) return null;
  return (rightPanelWidth - leftPanelWidth) / 2;
}
