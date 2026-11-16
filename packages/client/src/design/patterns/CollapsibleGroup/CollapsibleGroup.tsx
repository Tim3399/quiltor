import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import "./CollapsibleGroup.css";

export interface CollapsibleGroupProps {
  /** Unique within the page: the header's `aria-controls` points at `${id}-content`. */
  id: string;
  title: ReactNode;
  /** Number of entries, shown after the title and read out as part of the button's name. */
  count?: number;
  icon?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

/**
 * A titled group of list entries that folds away. The header is a real button, so Enter and
 * Space work without extra handlers. The state is controlled: where it is remembered (per
 * world, per list) is the caller's decision, see `useCollapsedGroups`.
 */
export function CollapsibleGroup({
  id,
  title,
  count,
  icon,
  open,
  onOpenChange,
  className = "",
  children,
}: CollapsibleGroupProps) {
  const contentId = `${id}-content`;
  return (
    <section className={`collapsible-group ${className}`.trim()} data-open={open}>
      <h3 className="collapsible-group__heading">
        <button
          type="button"
          className="collapsible-group__trigger"
          id={`${id}-trigger`}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRight className="collapsible-group__chevron" aria-hidden="true" />
          {icon && (
            <span className="collapsible-group__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <span className="collapsible-group__title">{title}</span>
          {count !== undefined && <small className="collapsible-group__count">{count}</small>}
        </button>
      </h3>
      <div id={contentId} className="collapsible-group__content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
