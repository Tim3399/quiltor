import { TextArea } from "./TextArea";

export function Default() {
  return <TextArea label="Kapitelnotiz" defaultValue="Die Unruhe am Hafen nur andeuten." />;
}

export function DescriptionAndHint() {
  return (
    <TextArea
      label="Szenenziel"
      description="Beschreibe, was sich durch diese Szene verändern soll."
      hint="Ein bis drei Sätze reichen meist aus."
      defaultValue="Mara erkennt, dass die Karte auf ihre Erinnerungen reagiert."
    />
  );
}

export function ErrorState() {
  return (
    <TextArea
      label="Kurzbeschreibung"
      defaultValue="Eine sehr lange Beschreibung"
      error="Die Kurzbeschreibung überschreitet die erlaubte Länge."
    />
  );
}

export function Disabled() {
  return <TextArea label="Archivierte Notiz" defaultValue="Nur zur Ansicht verfügbar." disabled />;
}

export function LongContent() {
  return (
    <TextArea
      label="Ausführliche Notiz zur Entwicklung der zentralen Beziehung"
      description="Dieses Beispiel enthält bewusst längere Inhalte, damit mehrzeilige Labels, Beschreibungen und Werte gemeinsam beurteilt werden können."
      hint="Der Textbereich wächst nicht automatisch, lässt sich aber weiterhin vertikal verändern."
      rows={8}
      defaultValue="Mara misstraut dem Archivar zunächst, weil er entscheidende Seiten aus dem Logbuch entfernt hat. Im Verlauf des Kapitels wird jedoch deutlich, dass er damit nicht die Wahrheit verbergen, sondern eine andere Figur schützen wollte."
    />
  );
}
