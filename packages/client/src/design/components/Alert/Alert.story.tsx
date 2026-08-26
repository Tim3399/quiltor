import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { Button } from "../../primitives/Button";
import { Alert } from "./Alert";

export function Tones() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Alert tone="info" icon={<Info />} title="Hinweis">
        Diese Information verändert deine Daten nicht.
      </Alert>
      <Alert tone="success" icon={<CheckCircle2 />} title="Gespeichert">
        Alle Änderungen sind sicher gespeichert.
      </Alert>
      <Alert tone="warning" icon={<TriangleAlert />} title="Noch nicht vollständig">
        Einige Angaben fehlen.
      </Alert>
      <Alert
        tone="danger"
        icon={<AlertCircle />}
        title="Nicht gespeichert"
        action={<Button tone="danger">Erneut versuchen</Button>}
      >
        Die Verbindung wurde unterbrochen.
      </Alert>
    </div>
  );
}

export function LongContent() {
  return (
    <Alert tone="warning" title="Ein ungewöhnlich langer Hinweis">
      Dieser Text prüft, dass auch ausführliche lokalisierte Meldungen innerhalb schmaler Flächen
      lesbar bleiben und die zugehörige Aktion nicht verdrängen.
    </Alert>
  );
}
