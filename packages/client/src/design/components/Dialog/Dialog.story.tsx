import { Button } from "../../primitives/Button";
import { Dialog, DialogFooter } from "./Dialog";

export function Default() {
  return (
    <Dialog
      title="Dokumentdetails"
      closeLabel="Dialog schließen"
      onClose={() => undefined}
      footer={
        <>
          <Button onClick={() => undefined}>Abbrechen</Button>
          <Button appearance="primary" onClick={() => undefined}>
            Speichern
          </Button>
        </>
      }
    >
      <p>Ein klar begrenzter Bereich für Aufgaben, die den Arbeitskontext unterbrechen.</p>
    </Dialog>
  );
}

export function Wide() {
  return (
    <Dialog
      size="wide"
      title="Große Vorschau"
      closeLabel="Vorschau schließen"
      onClose={() => undefined}
    >
      <p>Breite Inhalte erhalten mehr Raum, behalten aber dieselbe zugängliche Dialogstruktur.</p>
    </Dialog>
  );
}

export function CustomFooter() {
  return (
    <Dialog title="Eigener Footer" closeLabel="Dialog schließen" onClose={() => undefined}>
      <p>DialogFooter kann auch innerhalb des Inhalts eingesetzt werden.</p>
      <DialogFooter>
        <Button onClick={() => undefined}>Fertig</Button>
      </DialogFooter>
    </Dialog>
  );
}
