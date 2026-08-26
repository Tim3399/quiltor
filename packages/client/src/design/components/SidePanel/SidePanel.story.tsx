import { Info, X } from "lucide-react";
import { IconButton } from "../../primitives/IconButton";
import { SidePanel, SidePanelBody, SidePanelEmpty, SidePanelHeader } from "./SidePanel";

export function Inspector() {
  return (
    <SidePanel label="Figurinspektor">
      <SidePanelHeader
        title="Figur"
        actions={<IconButton label="Schließen" icon={<X />} size="touch" />}
      />
      <SidePanelBody>Fachlicher Inhalt wird über Children komponiert.</SidePanelBody>
    </SidePanel>
  );
}

export function Empty() {
  return (
    <SidePanel label="Figurinspektor">
      <SidePanelHeader title="Figur" />
      <SidePanelEmpty icon={<Info />} title="Nichts ausgewählt">
        Wähle auf der Arbeitsfläche ein Element aus.
      </SidePanelEmpty>
    </SidePanel>
  );
}

export function Fill() {
  return (
    <div style={{ width: 380 }}>
      <SidePanel label="Kapitel" side="start" width="fill">
        <SidePanelHeader title="Kapitel" />
        <SidePanelBody>Füllt einen Overlay- oder Sheet-Host vollständig aus.</SidePanelBody>
      </SidePanel>
    </div>
  );
}
