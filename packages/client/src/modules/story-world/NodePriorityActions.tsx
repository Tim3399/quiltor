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
}: NodePriorityActionsProps) {
  return (
    <div className={`node-priority-actions ${className}`.trim()}>
      <Button
        className="node-priority-action"
        appearance="secondary"
        icon={<Star />}
        aria-pressed={important}
        onClick={() => onImportantChange(!important)}
      >
        {importantLabel}
      </Button>
      <Button
        className="node-priority-action"
        appearance="secondary"
        icon={<Pin />}
        aria-pressed={pinned}
        onClick={() => onPinnedChange(!pinned)}
      >
        {pinnedLabel}
      </Button>
    </div>
  );
}
