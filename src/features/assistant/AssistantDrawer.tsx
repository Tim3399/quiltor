import { useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Bot, Check, Database, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { AssistantProposal, AssistantReply, AssistantSource, FigureState, Workspace } from '../../types';
import { proposalLabel, scopeAssistantProposals } from './proposals';

type Entry = { id: string; question: string; reply?: AssistantReply; error?: string; applied: number[] };

export function AssistantDrawer({ worldId, figures, onApply, onNavigate, onClose }: {
  worldId: string; figures: FigureState; onApply: (proposals: AssistantProposal[]) => void;
  onNavigate: (target: { workspace: Workspace; id: string }) => void; onClose: () => void;
}) {
  const storageKey = `quiltor-assistant:${worldId}`;
  const [entries, setEntries] = useState<Entry[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; } });
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ available: boolean; reason: string; chunks: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { api.assistantStatus().then(setStatus).catch(error => setStatus({ available: false, reason: String(error), chunks: 0 })); }, []);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(entries.slice(-40))); end.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries, storageKey]);
  const send = async () => {
    const question = draft.trim();
    if (!question || sending) return;
    const id = crypto.randomUUID();
    setDraft(''); setSending(true); setEntries(current => [...current, { id, question, applied: [] }]);
    try {
      const history = entries.slice(-6).flatMap(entry => [
        { role: 'user' as const, content: entry.question },
        ...(entry.reply ? [{ role: 'assistant' as const, content: entry.reply.message }] : []),
      ]);
      const response = await api.assistantChat(question, history);
      const reply = { ...response, proposals: scopeAssistantProposals(response.proposals || [], id) };
      setEntries(current => current.map(entry => entry.id === id ? { ...entry, reply } : entry));
    } catch (error) {
      setEntries(current => current.map(entry => entry.id === id ? { ...entry, error: error instanceof Error ? error.message : String(error) } : entry));
    } finally { setSending(false); }
  };
  const apply = (entryId: string, proposals: AssistantProposal[], indices: number[]) => {
    onApply(proposals);
    setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, applied: [...new Set([...entry.applied, ...indices])] } : entry));
  };
  return <aside className={`assistant-drawer ${status && !status.available ? 'has-offline' : ''}`} aria-label="Lokaler Assistent">
    <header><div><Sparkles /><span><strong>Assistent</strong><small>Lokal · nur Vorschläge</small></span></div><button className="icon-button" aria-label="Assistent schließen" onClick={onClose}><X /></button></header>
    <div className="assistant-scope"><Database /><span><strong>{status?.chunks ?? '…'} Quellen indexiert</strong><small>Welt, Manuskript, Profile, Beziehungen und Timeline</small></span></div>
    {status && !status.available && <div className="assistant-offline"><Bot /><div><strong>Lokales Modell nicht verfügbar</strong><p>{status.reason}</p><small>Quiltor selbst bleibt vollständig nutzbar.</small></div></div>}
    <div className="assistant-messages">
      {!entries.length && <div className="assistant-empty"><Bot /><h2>Wobei soll ich die Welt pflegen?</h2><p>Ich kann Figuren und Beziehungen vorbereiten, Timeline-Stände anlegen und vorhandene Informationen mit Quellen auswerten.</p><button onClick={() => setDraft('Lege aus meinen vorhandenen Notizen fehlende Figuren als Vorschläge an.')}>Fehlende Figuren finden</button><button onClick={() => setDraft('Prüfe die Beziehungen und Timeline auf Lücken oder Widersprüche.')}>Timeline prüfen</button></div>}
      {entries.map(entry => <article className="assistant-exchange" key={entry.id}>
        <p className="assistant-question">{entry.question}</p>
        {entry.error && <div className="assistant-error">{entry.error}</div>}
        {entry.reply && <div className="assistant-answer"><p>{entry.reply.message}</p>
          {!!entry.reply.sources?.length && <SourceList sources={entry.reply.sources} onNavigate={onNavigate} />}
          {!!entry.reply.proposals?.length && <div className="assistant-proposals"><div className="assistant-proposal-heading"><strong>{entry.reply.proposals.length} Vorschläge</strong><button disabled={entry.applied.length === entry.reply.proposals.length} onClick={() => { const pending = entry.reply!.proposals.map((proposal, index) => ({ proposal, index })).filter(item => !entry.applied.includes(item.index)); apply(entry.id, pending.map(item => item.proposal), pending.map(item => item.index)); }}><Check />Alle übernehmen</button></div>
            {entry.reply.proposals.map((proposal, index) => { const grouped = (entry.reply?.proposalGroup?.proposalIndexes.length || 0) > 1; return <div className={`assistant-proposal ${entry.applied.includes(index) ? 'is-applied' : ''}`} key={index}><span>{proposalLabel(proposal, figures)}</span><button disabled={entry.applied.includes(index) || grouped} title={grouped ? 'Dieser Vorschlag gehört zu einem atomaren Paket und wird nur gemeinsam übernommen.' : undefined} onClick={() => apply(entry.id, [proposal], [index])}>{entry.applied.includes(index) ? <><Check />Übernommen</> : grouped ? 'Im Paket' : 'Übernehmen'}</button></div>; })}
          </div>}
        </div>}
      </article>)}
      {sending && <div className="assistant-thinking"><span /><span /><span />Quiltor durchsucht deine Welt …</div>}
      <div ref={end} />
    </div>
    <footer><label><span className="sr-only">Nachricht an den lokalen Assistenten</span><textarea value={draft} disabled={sending || status?.available === false} placeholder="Figur anlegen, Beziehung ändern, Timeline prüfen …" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /></label><button aria-label="Nachricht senden" disabled={!draft.trim() || sending || status?.available === false} onClick={() => void send()}><ArrowUp /></button><small><BookOpen />Manuskript ist nur lesbarer Kontext. Änderungen werden nie automatisch angewendet.</small></footer>
  </aside>;
}

function SourceList({ sources, onNavigate }: { sources: AssistantSource[]; onNavigate: (target: { workspace: Workspace; id: string }) => void }) {
  return <div className="assistant-sources"><span>Quellen</span>{sources.map(source => <button key={source.id} title={source.text} onClick={() => onNavigate(source.target)}>{source.title}</button>)}</div>;
}
