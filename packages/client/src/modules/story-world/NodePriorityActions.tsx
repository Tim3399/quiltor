import { Pin, Star } from "lucide-react";
import { Button } from "../../design";

export interface NodePriorityActionsProps {
  important: boolean;
  pinned: boolean;
  importantLabel: string;
  pinnedLabel: string;
  onImportantChange: (important: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
  className?: string;
  actionClassName?: string;
}

/** Common importance and layout-lock actions for story graph nodes. */
export function NodePriorityActions({
  important,
  pinned,
  importantLabel,
  pinnedLabel,
  onImportantChange,
  onPinnedChange,
  className = "",
  actionClassName = "",
}: NodePriorityActionsProps) {
  return (
    <div className={`node-priority-actions ${className}`.trim()}>
      <Button
        className={`node-priority-action ${actionClassName} ${important ? "active" : ""}`.trim()}
        appearance={important ? "primary" : "secondary"}
        icon={<Star />}
        aria-pressed={important}
        onClick={() => onImportantChange(!important)}
      >
        {importantLabel}
      </Button>
      <Button
        className={`node-priority-action ${actionClassName} ${pinned ? "active" : ""}`.trim()}
        appearance={pinned ? "primary" : "secondary"}
        icon={<Pin />}
        aria-pressed={pinned}
        onClick={() => onPinnedChange(!pinned)}
      >
        {pinnedLabel}
      </Button>
    </div>
  );
}
