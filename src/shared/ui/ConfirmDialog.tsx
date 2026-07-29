import { AlertTriangle } from 'lucide-react';
import { Dialog } from './Dialog';

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: {
  title: string; description: string; confirmLabel: string; onConfirm: () => void; onClose: () => void;
}) {
  return <Dialog title={title} onClose={onClose}>
    <div className="confirm-message"><AlertTriangle aria-hidden="true" /><p>{description}</p></div>
    <div className="dialog-actions"><button onClick={onClose}>Abbrechen</button><button className="danger-button" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></div>
  </Dialog>;
}
