import { MoreHorizontal, Plus, RotateCw, Trash2, X } from "lucide-react";
import { IconButton } from "./IconButton";

export function Ghost() {
  return <IconButton label="Mehr Aktionen" icon={<MoreHorizontal />} />;
}

export function Secondary() {
  return <IconButton label="Hinzufügen" icon={<Plus />} appearance="secondary" />;
}

export function Primary() {
  return <IconButton label="Hinzufügen" icon={<Plus />} appearance="primary" />;
}

export function Danger() {
  return <IconButton label="Löschen" icon={<Trash2 />} tone="danger" />;
}

export function Loading() {
  return (
    <IconButton label="Neu laden" loadingLabel="Wird neu geladen" icon={<RotateCw />} loading />
  );
}

export function Disabled() {
  return <IconButton label="Schließen" icon={<X />} disabled />;
}

export function Pressed() {
  return <IconButton label="Ansicht fixieren" icon={<Plus />} aria-pressed="true" />;
}

export function Touch() {
  return <IconButton label="Hinzufügen" icon={<Plus />} size="touch" />;
}
