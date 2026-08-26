import { Disclosure } from "./Disclosure";

export function Closed() {
  return <Disclosure summary="Weitere Einstellungen">Zusätzliche Optionen</Disclosure>;
}

export function Open() {
  return (
    <Disclosure summary="Chronik" open>
      Historischer Inhalt der ausgewählten Entität.
    </Disclosure>
  );
}

export function LongSummary() {
  return (
    <Disclosure summary="Eine ungewöhnlich lange Zusammenfassung für einen sehr schmalen Inspector">
      Der Inhalt bleibt unabhängig von der Länge der Zusammenfassung erreichbar.
    </Disclosure>
  );
}
