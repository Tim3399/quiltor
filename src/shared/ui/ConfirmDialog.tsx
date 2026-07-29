import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from './Dialog';

export function ConfirmDialog({ title, description, confirmLabel, holdDurationMs = 0, onConfirm, onClose }: {
  title: string; description: string; confirmLabel: string; holdDurationMs?: number; onConfirm: () => void; onClose: () => void;
}) {
  const complete = () => { onConfirm(); onClose(); };
  return <Dialog title={title} onClose={onClose}>
    <div className="confirm-message"><AlertTriangle aria-hidden="true" /><p>{description}</p></div>
    <div className="dialog-actions"><button onClick={onClose}>Abbrechen</button>{holdDurationMs > 0 ? <HoldButton label={confirmLabel} duration={holdDurationMs} onComplete={complete} /> : <button className="danger-button" onClick={complete}>{confirmLabel}</button>}</div>
  </Dialog>;
}

function HoldButton({ label, duration, onComplete }: { label: string; duration: number; onComplete: () => void }) {
  const [startedAt, setStartedAt] = useState<number | null>(null), [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null), completed = useRef(false);
  const cancel = () => { if (timer.current !== null) window.clearInterval(timer.current); timer.current = null; completed.current = false; setStartedAt(null); setProgress(0); };
  const start = () => {
    if (startedAt !== null) return;
    const startTime = performance.now(); completed.current = false; setStartedAt(startTime); setProgress(0);
    timer.current = window.setInterval(() => {
      const next = Math.min(1, (performance.now() - startTime) / duration); setProgress(next);
      if (next >= 1 && !completed.current) { completed.current = true; if (timer.current !== null) window.clearInterval(timer.current); onComplete(); }
    }, 40);
  };
  useEffect(() => () => { if (timer.current !== null) window.clearInterval(timer.current); }, []);
  const remaining = Math.max(1, Math.ceil((duration * (1 - progress)) / 1000));
  return <button className={`danger-button hold-button ${startedAt !== null ? 'is-holding' : ''}`} style={{ '--hold-progress': progress } as React.CSSProperties}
    aria-label={`${label} – 5 Sekunden halten`} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); start(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
    onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); start(); } }} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') cancel(); }} onBlur={cancel}>
    <span>{startedAt === null ? `${label} · 5 Sek. halten` : `Weiter halten · ${remaining}`}</span>
  </button>;
}
