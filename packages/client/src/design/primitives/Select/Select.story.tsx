import { Select } from "./Select";

export function Default() {
  return (
    <Select label="Figurentyp" defaultValue="person">
      <option value="person">Person</option>
      <option value="animal">Tier</option>
      <option value="organisation">Organisation</option>
    </Select>
  );
}

export function Hint() {
  return (
    <Select
      label="Zeitsystem"
      hint="Die Auswahl ändert nur die Darstellung, nicht die Reihenfolge der Zeitpunkte."
      defaultValue="gregorian"
    >
      <option value="relative">Relativ</option>
      <option value="gregorian">Gregorianisch</option>
      <option value="custom">Eigener Kalender</option>
    </Select>
  );
}

export function ErrorState() {
  return (
    <Select label="Bezugspunkt" error="Bitte wähle einen Bezugspunkt." defaultValue="">
      <option value="">Bitte auswählen</option>
      <option value="arrival">Ankunft</option>
      <option value="departure">Abreise</option>
    </Select>
  );
}

export function Disabled() {
  return (
    <Select label="Archivierter Status" defaultValue="published" disabled>
      <option value="published">Veröffentlicht</option>
    </Select>
  );
}

export function LongContent() {
  return (
    <Select
      label="Ausführliche Bezeichnung für die zeitliche Einordnung dieses Kapitels"
      description="Lange Labels, Hilfetexte und Optionsinhalte müssen umbrechen können, ohne ihre zugängliche Zuordnung zu verlieren."
      defaultValue="archive"
    >
      <option value="harbour">Der erste Morgen nach der unerwarteten Ankunft im Nordhafen</option>
      <option value="archive">Der lange Nachmittag im ehemaligen königlichen Gezeitenarchiv</option>
    </Select>
  );
}
