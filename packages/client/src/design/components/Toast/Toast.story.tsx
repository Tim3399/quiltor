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
