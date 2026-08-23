import { Checkbox } from "./Checkbox";

export function Default() {
  return <Checkbox label="Automatische Sicherungen aktivieren" />;
}

export function Checked() {
  return <Checkbox label="Im Manuskript anzeigen" defaultChecked />;
}

export function Disabled() {
  return (
    <Checkbox
      label="Von der Plattform verwaltet"
      hint="Diese Einstellung kann hier nicht geändert werden."
      defaultChecked
      disabled
    />
  );
}

export function ErrorState() {
  return (
    <Checkbox
      label="Lizenzbedingungen akzeptieren"
      error="Die Zustimmung ist erforderlich, bevor du fortfahren kannst."
    />
  );
}

export function LongContent() {
  return (
    <Checkbox
      label="Änderungen an dieser Welt automatisch auf allen verbundenen Geräten verfügbar machen"
      description="Die Synchronisierung umfasst Manuskript, Figuren, Orte und Timeline sowie alle zugehörigen Metadaten."
      hint="Bei großen Projekten kann die erste Übertragung einige Zeit dauern."
    />
  );
}

export function Touch() {
  return (
    <Checkbox
      label="Mit einem gut erreichbaren Touch-Ziel auswählen"
      hint="Die gesamte beschriftete Zeile ist interaktiv."
    />
  );
}
