import { Download, Plus, Trash2 } from "lucide-react";
import { Button } from "./Button";

export function Primary() {
  return <Button appearance="primary">Neue Szene</Button>;
}

export function Secondary() {
  return <Button appearance="secondary">Abbrechen</Button>;
}

export function Ghost() {
  return <Button appearance="ghost">Mehr anzeigen</Button>;
}

export function Danger() {
  return (
    <Button appearance="primary" tone="danger" icon={<Trash2 />}>
      Welt löschen
    </Button>
  );
}

export function Loading() {
  return (
    <Button appearance="primary" loading loadingLabel="Export wird erstellt">
      Export erstellen
    </Button>
  );
}

export function Disabled() {
  return <Button disabled>Nicht verfügbar</Button>;
}

export function Pressed() {
  return (
    <Button appearance="ghost" aria-pressed="true">
      Ausgewählte Ansicht
    </Button>
  );
}

export function WithLeadingIcon() {
  return <Button icon={<Plus />}>Kapitel anlegen</Button>;
}

export function WithTrailingIcon() {
  return (
    <Button appearance="ghost" icon={<Download />} iconPosition="end">
      Manuskript exportieren
    </Button>
  );
}

export function Touch() {
  return <Button size="touch">Touch-Aktion</Button>;
}

export function LongLabel() {
  return <Button>Eine ungewöhnlich lange Aktion mit erklärendem Text ausführen</Button>;
}
