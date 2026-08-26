import { ProgressBar } from "./ProgressBar";

export function Determinate() {
  return <ProgressBar label="Kapitel verarbeitet" value={7} max={12} showValue />;
}

export function Complete() {
  return <ProgressBar label="Installation abgeschlossen" value={100} showValue />;
}

export function Indeterminate() {
  return <ProgressBar label="Modell wird vorbereitet" />;
}
