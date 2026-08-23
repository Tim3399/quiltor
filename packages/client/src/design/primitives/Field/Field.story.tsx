import { Field } from "./Field";

export function Default() {
  return (
    <Field label="Arbeitstitel">
      <input defaultValue="Der gläserne Atlas" />
    </Field>
  );
}

export function DescriptionAndHint() {
  return (
    <Field
      label="Projektname"
      description="Dieser Name erscheint in der Weltenübersicht."
      hint="Er kann später jederzeit geändert werden."
    >
      <input defaultValue="Nordhafen" />
    </Field>
  );
}

export function ErrorState() {
  return (
    <Field label="Projektname" error="Bitte gib dem Projekt einen Namen.">
      <input />
    </Field>
  );
}

export function LongContent() {
  return (
    <Field
      label="Ausführlich beschriftetes Metadatenfeld"
      description="Eine längere Beschreibung zeigt, wie das Feld mit erklärenden Texten umbricht, ohne die Beziehung zum Control zu verlieren."
      hint="Auch Hinweise dürfen mehrzeilig sein und bleiben für assistive Technologien mit dem Control verknüpft."
    >
      <input defaultValue="Ein bewusst längerer Beispielwert für die Komponenten-Galerie" />
    </Field>
  );
}
