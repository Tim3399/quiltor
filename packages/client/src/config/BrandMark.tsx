import { BRAND_MARK_BODY, BRAND_MARK_TAIL, BRAND_MARK_VIEW_BOX } from "./brandMark.generated";
import "./BrandMark.css";

/**
 * Quiltor's mark, logo 3: the Q in the surrounding text colour, its tail in the theme's gold.
 * Decorative wherever it stands next to the product name, so it is hidden from assistive tech.
 */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      viewBox={BRAND_MARK_VIEW_BOX}
      aria-hidden="true"
      focusable="false"
    >
      <path className="brand-mark__tail" d={BRAND_MARK_TAIL} />
      <path className="brand-mark__body" d={BRAND_MARK_BODY} />
    </svg>
  );
}
