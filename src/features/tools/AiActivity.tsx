import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import type { AssistantInteraction } from '../../types';

// Plain-language names so a non-technical reader understands what happened, without any JSON.
const PROPOSAL_LABELS: Record<string, string> = {
  create_element: 'Neues Element',
  update_element: 'Element ergänzt',
  create_relationship: 'Neue Beziehung',
  set_relationship_at_moment: 'Beziehungsstand geändert',
  create_timeline_moment: 'Neuer Zeitpunkt',
  mark_deceased: 'Als verstorben markiert',
  arrange_elements: 'Board neu sortiert',
};

const STEP_LABELS: Record<string, string> = {
  initial_search: 'Kontext durchsucht',
  deterministic: 'Direkt gebaut (ohne KI-Lauf)',
  plan: 'Vorgehen geplant',
  search_world: 'Welt durchsucht',
  propose: 'KI-Vorschlag erstellt',
  repair: 'Vorschlag nachgebessert',
  clarify: 'Rückfrage gestellt',
  clarify_resolved: 'Rückfrage beantwortet',
  verify: 'Geprüft',
  batch_start: 'Kapitelweise verarbeitet',
  digest: 'Kapitel zusammengefasst',
  reduce: 'Teilergebnisse verdichtet',
  context_overflow: 'Kontext war zu groß',
  preflight: 'Vorabprüfung',
  force_context: 'Ausgewählte Kapitel einbezogen',
};

function badge(item: AssistantInteraction): string {
  if (item.status === 'failed') return 'Fehler';
  if (item.response?.clarification) return 'Rückfrage';
  const count = item.response?.proposals?.length || 0;
  if (count) return `${count} Vorschlag${count === 1 ? '' : 'e'}`;
  return 'Antwort';
}

export function AiActivity() {
  const [items, setItems] = useState<AssistantInteraction[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void api.assistantLogs().then(result => setItems(result.interactions)).catch(() => setItems([])); }, []);

  if (!items) return <p className="ai-activity-empty">Lade …</p>;
  if (!items.length) return <p className="ai-activity-empty">Noch keine KI-Aktivität in dieser Welt. Was der Assistent tut, erscheint hier.</p>;

  return <div className="ai-activity">
    {items.map(item => {
      const proposals = item.response?.proposals || [];
      const steps = [...new Set((item.response?.agentTrace || []).map(step => STEP_LABELS[step.step] || step.step))];
      return <article className="ai-activity-item" key={item.id}>
        <header>
          <time>{new Date(item.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</time>
          <span className={`ai-badge ${item.status === 'failed' ? 'is-error' : ''}`}>{badge(item)}</span>
        </header>
        <p className="ai-activity-q"><strong>Gefragt:</strong> {item.question}</p>
        {item.response?.message && <p className="ai-activity-a">{item.response.message}</p>}
        {item.status === 'failed' && item.error && <p className="ai-activity-a is-error">{item.error}</p>}
        {!!proposals.length && <ul className="ai-activity-changes">{proposals.map((proposal, index) => <li key={index}>{PROPOSAL_LABELS[proposal.kind] || proposal.kind}</li>)}</ul>}
        <button className="ai-activity-toggle" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>
          <ChevronDown />{open === item.id ? 'Details verbergen' : 'Anfrage & Antwort anzeigen'}
        </button>
        {open === item.id && <dl className="ai-activity-details">
          <dt>Anfrage</dt><dd>{item.question}</dd>
          <dt>Antwort</dt><dd>{item.response?.message || item.error || '—'}</dd>
          {!!steps.length && <><dt>Ablauf</dt><dd>{steps.join(' · ')}</dd></>}
        </dl>}
      </article>;
    })}
  </div>;
}
