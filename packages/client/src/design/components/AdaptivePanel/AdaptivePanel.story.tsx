import { AdaptivePanel } from "./AdaptivePanel";

export function Inline() {
  return (
    <AdaptivePanel
      open
      presentation="inline"
      label="Figurinspektor"
      title="Figur"
      closeLabel="Inspector schließen"
      onClose={() => undefined}
    >
      Die breite Ansicht verwendet eine ergänzende Seitenfläche.
    </AdaptivePanel>
  );
}

export function Overlay() {
  return (
    <AdaptivePanel
      open
      presentation="overlay"
      label="Figurinspektor"
      title="Figur"
      closeLabel="Inspector schließen"
      onClose={() => undefined}
    >
      Die kompakte Ansicht verwendet dieselben Inhalte in einer modalen Seitenfläche.
    </AdaptivePanel>
  );
}
