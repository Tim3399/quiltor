import { SaveStatus } from "./SaveStatus";

export function Phases() {
  return (
    <div style={{ display: "grid", justifyItems: "start", gap: 12 }}>
      <SaveStatus phase="idle" label="Bereit" />
      <SaveStatus phase="dirty" label="Ungespeichert" />
      <SaveStatus phase="saving" label="Wird gespeichert" />
      <SaveStatus phase="saved" label="Gespeichert" />
      <SaveStatus
        phase="error"
        label="Nicht gespeichert"
        error="Die Verbindung wurde unterbrochen."
        retryLabel="Erneut versuchen"
        onRetry={() => undefined}
      />
    </div>
  );
}

export function LongError() {
  return (
    <SaveStatus
      phase="error"
      label="Die letzten Änderungen konnten noch nicht sicher gespeichert werden"
      error="Die Verbindung wurde unterbrochen."
      retryLabel="Erneut versuchen"
      onRetry={() => undefined}
    />
  );
}

export function AttentionOnlyLabel() {
  return <SaveStatus phase="saving" label="Wird gespeichert" labelVisibility="attention" />;
}
