import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../design";

export interface ModeBannerProps {
  icon: ReactNode;
  children: ReactNode;
  dismissLabel: string;
  onDismiss: () => void;
  className?: string;
}

/** Persistent status banner for temporary canvas interaction modes. */
export function ModeBanner({
  icon,
  children,
  dismissLabel,
  onDismiss,
  className = "",
}: ModeBannerProps) {
  return (
    <div className={`mode-banner ${className}`.trim()} role="status">
      <span className="mode-banner-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="mode-banner-copy">{children}</span>
      <IconButton
        className="mode-banner-dismiss"
        label={dismissLabel}
        icon={<X />}
        onClick={onDismiss}
      />
    </div>
  );
}
