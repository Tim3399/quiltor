import { TextField } from "./TextField";

export function Default() {
  return <TextField label="Figurenname" defaultValue="Mara Venn" />;
}

export function DescriptionAndHint() {
  return (
    <TextField
      label="Arbeitstitel"
      description="Der interne Titel dieses Kapitels."
      hint="Er muss nicht mit der späteren Kapitelüberschrift übereinstimmen."
      defaultValue="Ankunft im Hafen"
    />
  );
}

export function ErrorState() {
  return <TextField label="Arbeitstitel" error="Ein Arbeitstitel ist erforderlich." />;
}

export function Disabled() {
  return <TextField label="Importierte Kennung" defaultValue="ARCHIV-1847" disabled />;
}

export function LongContent() {
  return (
    <TextField
      label="Ausführliche Bezeichnung für einen wiederkehrenden Schauplatz"
      description="Lange Beschriftungen und Beschreibungen dürfen umbrechen, ohne dass der Fokus oder die semantische Zuordnung verloren geht."
      defaultValue="Das ehemalige königliche Gezeitenarchiv am nördlichen Rand des alten Hafens"
    />
  );
}
