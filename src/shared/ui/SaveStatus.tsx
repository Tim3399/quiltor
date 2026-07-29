import { AlertCircle, Check, CloudOff, LoaderCircle } from 'lucide-react';
import type { SavePhase } from '../../types';

const labels: Record<SavePhase, string> = {
  idle: 'Bereit', dirty: 'Ungespeichert', saving: 'Speichert …', saved: 'Gespeichert', error: 'Nicht gespeichert',
};

export function SaveStatus({ phase, error, onRetry }: { phase: SavePhase; error?: string; onRetry?: () => void }) {
  const Icon = phase === 'error' ? CloudOff : phase === 'saving' ? LoaderCircle : phase === 'saved' ? Check : phase === 'dirty' ? AlertCircle : Check;
  return <button className={`save-status save-${phase}`} onClick={phase === 'error' ? onRetry : undefined}
    title={error || labels[phase]} aria-live="polite">
    <Icon size={15} className={phase === 'saving' ? 'spin' : ''} aria-hidden="true" />
    <span>{labels[phase]}</span>
  </button>;
}
