import { Clock3, FileText, MapPin, PanelsTopLeft, Users } from "lucide-react";
import { Button, ScrollArea } from "../../design";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";

export interface WorkspaceSwitcherProps {
  value: Workspace;
  onChange: (value: Workspace) => void;
}

const workspaces = [
  { value: "text", label: "text", icon: FileText },
  { value: "figures", label: "figures", icon: Users },
  { value: "timeline", label: "timeline", icon: Clock3 },
  { value: "places", label: "places", icon: MapPin },
  { value: "storyboard", label: "storyboard", icon: PanelsTopLeft },
] as const;

/** App-level navigation between Quiltors five primary workspaces. */
export function WorkspaceSwitcher({ value, onChange }: WorkspaceSwitcherProps) {
  const { t } = useI18n();

  return (
    <ScrollArea
      as="nav"
      axis="x"
      gutter="auto"
      scrollbar="hidden"
      className="workspace-switch"
      aria-label={t("workspaceNav")}
    >
      {workspaces.map((workspace) => {
        const Icon = workspace.icon;
        const label = t(workspace.label);

        return (
          <Button
            key={workspace.value}
            className="app-bar__workspace-button"
            appearance="ghost"
            icon={<Icon />}
            aria-label={label}
            aria-current={value === workspace.value ? "page" : undefined}
            onClick={() => onChange(workspace.value)}
          >
            <span className="app-bar__workspace-label">{label}</span>
          </Button>
        );
      })}
    </ScrollArea>
  );
}
