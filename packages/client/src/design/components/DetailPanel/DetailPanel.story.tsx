import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../primitives/IconButton";
import { SidePanelEmpty } from "../SidePanel";
import { TabPanel } from "../Tabs";
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelDeleteButton,
  DetailPanelFooter,
  DetailPanelTabs,
} from "./DetailPanel";

// The drawer lies over a positioned work area, so every story gives it one.
const frame = {
  position: "relative",
  display: "flex",
  justifyContent: "flex-end",
  height: 420,
} as const;

export function Default() {
  return (
    <div style={frame}>
      <DetailPanel
        label="Figuren-Inspector"
        open
        compact={false}
        eyebrow="Figur"
        title="Mara Lind"
        closeLabel="Auswahl schließen"
        onClose={() => undefined}
      >
        <DetailPanelBody>Kurzbeschreibung, Beinamen und Notizen stehen hier.</DetailPanelBody>
        <DetailPanelFooter>
          <DetailPanelDeleteButton label="Figur löschen" onClick={() => undefined} />
        </DetailPanelFooter>
      </DetailPanel>
    </div>
  );
}

export function WithTabs() {
  const [tab, setTab] = useState("place");
  return (
    <div style={frame}>
      <DetailPanel
        label="Orte-Inspector"
        open
        compact={false}
        eyebrow="Ort"
        title="Alter Hafen mit dem besonders langen Namen der Speicherstadt"
        closeLabel="Auswahl schließen"
        onClose={() => undefined}
      >
        <DetailPanelTabs
          label="Ortsangaben"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "place", label: "Ort" },
            { value: "history", label: "Verlauf" },
          ]}
        >
          <DetailPanelBody>
            <TabPanel value="place">Name, Beschreibung und Karte.</TabPanel>
            <TabPanel value="history">Änderungen über die Zeit.</TabPanel>
          </DetailPanelBody>
        </DetailPanelTabs>
        <DetailPanelFooter>
          <DetailPanelDeleteButton label="Ort löschen" onClick={() => undefined} />
        </DetailPanelFooter>
      </DetailPanel>
    </div>
  );
}

export function Drawer() {
  return (
    <div style={{ position: "relative", height: 420 }}>
      <p style={{ margin: 16 }}>Die Arbeitsfläche bleibt bedienbar.</p>
      <DetailPanel
        label="Zeitpunkt"
        open
        compact
        eyebrow="Zeitpunkt"
        title="Sturmnacht"
        closeLabel="Schließen"
        onClose={() => undefined}
        headerActions={
          <>
            <IconButton label="Früherer Zeitpunkt" icon={<ChevronLeft />} size="touch" />
            <IconButton label="Späterer Zeitpunkt" icon={<ChevronRight />} size="touch" />
          </>
        }
      >
        <DetailPanelBody>Titel, Zeit und Notiz des Zeitpunkts.</DetailPanelBody>
        <DetailPanelFooter>
          <DetailPanelDeleteButton
            label="Zeitpunkt löschen"
            disabled
            disabledReason="Zwei Kapitel spielen zu diesem Zeitpunkt."
            onClick={() => undefined}
          />
        </DetailPanelFooter>
      </DetailPanel>
    </div>
  );
}

export function Empty() {
  return (
    <div style={frame}>
      <DetailPanel
        label="Figuren-Inspector"
        open={false}
        compact={false}
        closeLabel="Auswahl schließen"
        onClose={() => undefined}
        empty={
          <SidePanelEmpty icon={<Info />} title="Element auswählen">
            Wähle auf der Arbeitsfläche ein Element aus.
          </SidePanelEmpty>
        }
      />
    </div>
  );
}
