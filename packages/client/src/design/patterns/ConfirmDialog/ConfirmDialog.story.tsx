import { ConfirmDialog, IRREVERSIBLE_HOLD_MS } from "./ConfirmDialog";

export function Default() {
  return (
    <ConfirmDialog
      title="Kapitel löschen?"
      description="Das Kapitel wird aus dem Manuskript entfernt."
      supportingText="Diese Aktion kann rückgängig gemacht werden."
      closeLabel="Dialog schließen"
      cancelLabel="Abbrechen"
      confirmLabel="Kapitel löschen"
      onConfirm={() => undefined}
      onClose={() => undefined}
    />
  );
}

export function HoldToConfirm() {
  return (
    <ConfirmDialog
      confirmation="hold"
      holdDurationMs={IRREVERSIBLE_HOLD_MS}
      holdLabels={{
        accessible: "Welt löschen – gedrückt halten zum Bestätigen",
        idle: "Welt löschen · gedrückt halten",
        active: "Weiter halten …",
      }}
      title="Welt endgültig löschen?"
      description="Datenbank, Sicherungen und Verlauf werden entfernt."
      closeLabel="Dialog schließen"
      cancelLabel="Abbrechen"
      confirmLabel="Welt löschen"
      onConfirm={() => undefined}
      onClose={() => undefined}
    />
  );
}
