import { Button } from "../../primitives/Button";
import { Toast, ToastRegion } from "./Toast";

export function Default() {
  return (
    <ToastRegion label="Meldungen">
      <Toast title="Gespeichert" onDismiss={() => undefined} dismissLabel="Meldung schließen">
        Alle Änderungen sind sicher.
      </Toast>
    </ToastRegion>
  );
}

export function ErrorWithRetry() {
  return (
    <Toast
      tone="danger"
      title="Nicht gespeichert"
      action={<Button tone="danger">Erneut versuchen</Button>}
      onDismiss={() => undefined}
      dismissLabel="Meldung schließen"
    >
      Die Verbindung wurde unterbrochen.
    </Toast>
  );
}

export function TonesAndLongContent() {
  return (
    <ToastRegion label="Semantische Meldungen">
      <Toast tone="info" title="Information">
        Die neue Fassung steht jetzt für alle Mitwirkenden zur Prüfung bereit.
      </Toast>
      <Toast tone="success" title="Erfolgreich gespeichert">
        Alle Kapitel, Figurenbeziehungen und Ortsnotizen wurden vollständig übernommen.
      </Toast>
      <Toast tone="warning" title="Konflikt vor dem Speichern prüfen">
        Diese Fassung enthält widersprüchliche Änderungen und sollte vor dem Fortfahren geprüft
        werden.
      </Toast>
      <Toast tone="danger" title="Speichern fehlgeschlagen">
        Die Änderungen konnten nicht dauerhaft gesichert werden.
      </Toast>
    </ToastRegion>
  );
}
