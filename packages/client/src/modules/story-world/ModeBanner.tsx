import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../design";

export interface ModeBannerProps {
  icon: ReactNode;
  children: ReactNode;
  dismissLabel: string;
  onDismiss: () => void;
  className?: string;
  /** "info" for a mode that only explains itself; "warning" asks for care. */
  tone?: "warning" | "info";
}

/** Persistent status banner for temporary canvas interaction modes. */
export function ModeBanner({
  icon,
  children,
  dismissLabel,
  onDismiss,
  className = "",
  tone = "warning",
}: ModeBannerProps) {
  const toneClass = tone === "info" ? " mode-banner--info" : "";
  return (
    <div className={`mode-banner${toneClass} ${className}`.trim()} role="status">
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
