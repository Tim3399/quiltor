import { AlertCircle, Check, CloudOff, LoaderCircle } from 'lucide-react';
import type { SavePhase } from '../../types';
import { useLanguage, type MessageKey } from '../../language';

const labelKeys: Record<SavePhase, MessageKey> = {
  idle: 'ready', dirty: 'unsaved', saving: 'saving', saved: 'saved', error: 'notSaved',
};

export function SaveStatus({ phase, error, onRetry }: { phase: SavePhase; error?: string; onRetry?: () => void }) {
  const { t } = useLanguage();
  const Icon = phase === 'error' ? CloudOff : phase === 'saving' ? LoaderCircle : phase === 'saved' ? Check : phase === 'dirty' ? AlertCircle : Check;
  return <button className={`save-status save-${phase}`} onClick={phase === 'error' ? onRetry : undefined}
    title={error || t(labelKeys[phase])} aria-live="polite">
    <Icon size={15} className={phase === 'saving' ? 'spin' : ''} aria-hidden="true" />
    <span>{t(labelKeys[phase])}</span>
  </button>;
}
