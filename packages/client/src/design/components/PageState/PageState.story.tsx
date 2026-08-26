import { Button } from "../../primitives/Button";
import { PageState } from "./PageState";

export function Loading() {
  return (
    <PageState kind="loading" mark="Q">
      Werkstatt wird geöffnet.
    </PageState>
  );
}

export function ErrorState() {
  return (
    <PageState
      kind="error"
      mark="Q"
      title="Die Werkstatt ist nicht erreichbar"
      actions={<Button appearance="primary">Erneut versuchen</Button>}
    >
      Prüfe die Verbindung und versuche es anschließend erneut.
    </PageState>
  );
}
