import { Download, Focus, Plus } from "lucide-react";
import { ToolbarButton } from "./ToolbarButton";

export function ResponsiveLabel() {
  return <ToolbarButton label="Neues Kapitel" icon={<Plus />} appearance="primary" />;
}

export function Pressed() {
  return <ToolbarButton label="Fokus" icon={<Focus />} aria-pressed="true" />;
}

export function PersistentLabel() {
  return <ToolbarButton label="Exportieren" icon={<Download />} labelMode="always" />;
}

export function Disabled() {
  return <ToolbarButton label="Exportieren" icon={<Download />} disabled />;
}
