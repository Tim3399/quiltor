import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Bot, Check, ChevronDown, Database, Plus, RotateCw, Sparkles, Square, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { AssistantProposal, AssistantReply, AssistantSource, Chapter, FigureState, Workspace } from '../../types';
import { proposalLabel, scopeAssistantProposals } from './proposals';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

const STATUS_POLL_MS = 15000;

type Entry = { id: string; question: string; reply?: AssistantReply; error?: string; applied: number[] };

export function AssistantDrawer({ worldId, figures, chapters, onApply, onNavigate, onClose }: {
  worldId: string; figures: FigureState; chapters: Chapter[]; onApply: (proposals: AssistantProposal[]) => void;
  onNavigate: (target: { workspace: Workspace; id: string }) => void; onClose: () => void;
}) {
  const storageKey = `quiltor-assistant:${worldId}`;
  const [entries, setEntries] = useState<Entry[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; } });
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ available: boolean; reason: string; chunks: number } | null>(null);
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [forcedChapterIds, setForcedChapterIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ total: number; done: number; label: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chapterPickerRef = useRef<HTMLDetailsElement>(null);
  const openChapterPicker = () => { const el = chapterPickerRef.current; if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } };
  const checkStatus = useCallback(() => {
    api.assistantStatus().then(setStatus).catch(error => setStatus({ available: false, reason: String(error), chunks: 0 }));
  }, []);
  useEffect(() => {
    checkStatus();
    const interval = window.setInterval(checkStatus, STATUS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [checkStatus]);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(entries.slice(-40))); end.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries, storageKey]);
  const send = async (retryId?: string, opts?: { batch?: boolean }) => {
    const question = retryId ? entries.find(entry => entry.id === retryId)?.question : draft.trim();
    if (!question || sending) return;
    const id = retryId ?? crypto.randomUUID();
    if (retryId) setEntries(current => current.map(entry => entry.id === id ? { ...entry, error: undefined } : entry));
    else { setDraft(''); setEntries(current => [...current, { id, question, applied: [] }]); }
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let progressInterval: number | undefined;
    try {
      // Send the whole (locally capped) transcript -- the backend picks however much
      // actually fits the model's real token budget (backend/assistant.py's
      // conversation_messages), so there's no need to pre-guess a turn count here.
      const history = entries.filter(entry => entry.id !== id).flatMap(entry => [
        { role: 'user' as const, content: entry.question },
        ...(entry.reply ? [{ role: 'assistant' as const, content: entry.reply.message }] : []),
      ]);
      const batch = opts?.batch ? { runBatches: true, progressId: crypto.randomUUID() } : undefined;
      if (batch) {
        setBatchProgress({ total: 0, done: 0, label: '' });
        progressInterval = window.setInterval(() => {
          api.assistantProgress(batch.progressId).then(res => { if (res.progress) setBatchProgress(res.progress); }).catch(() => {});
        }, 1500);
      }
      const response = await api.assistantChat(question, history, controller.signal, forcedChapterIds.length ? forcedChapterIds : undefined, batch);
      const reply = { ...response, proposals: scopeAssistantProposals(response.proposals || [], id) };
      setEntries(current => current.map(entry => entry.id === id ? { ...entry, reply } : entry));
    } catch (error) {
      const message = controller.signal.aborted ? 'Anfrage abgebrochen.' : error instanceof Error ? error.message : String(error);
      setEntries(current => current.map(entry => entry.id === id ? { ...entry, error: message } : entry));
    } finally {
      setSending(false); abortRef.current = null;
      if (progressInterval) window.clearInterval(progressInterval);
      setBatchProgress(null);
    }
  };
  const cancel = () => abortRef.current?.abort();
  const apply = (entryId: string, proposals: AssistantProposal[], indices: number[]) => {
    onApply(proposals);
    setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, applied: [...new Set([...entry.applied, ...indices])] } : entry));
  };
  return <aside className={`assistant-drawer ${status && !status.available ? 'has-offline' : ''}`} aria-label="Lokaler Assistent">
    <header><div><Sparkles /><span><strong>Assistent</strong><small>Lokal · nur Vorschläge</small></span></div>
      <div className="assistant-header-actions">
        <button className="icon-button" disabled={!entries.length} aria-label="Neuer Chat" title="Neuer Chat" onClick={() => setConfirmNewChat(true)}><Plus /></button>
        <button className="icon-button" aria-label="Assistent schließen" onClick={onClose}><X /></button>
      </div>
    </header>
    <div className="assistant-scope"><Database /><span><strong>{status?.chunks ?? '…'} Quellen indexiert</strong><small>Welt, Manuskript, Profile, Beziehungen und Timeline</small></span></div>
    {status && !status.available && <div className="assistant-offline"><Bot /><div><strong>Lokales Modell nicht verfügbar</strong><p>{status.reason}</p><small>Quiltor selbst bleibt vollständig nutzbar.</small><button onClick={checkStatus}><RotateCw />Nochmal versuchen</button></div></div>}
    <div className="assistant-messages">
      {!entries.length && <div className="assistant-empty"><Bot /><h2>Wobei soll ich die Welt pflegen?</h2><p>Ich kann Figuren und Beziehungen vorbereiten, Timeline-Stände anlegen und vorhandene Informationen mit Quellen auswerten.</p><button onClick={() => setDraft('Lege aus meinen vorhandenen Notizen fehlende Figuren als Vorschläge an.')}>Fehlende Figuren finden</button><button onClick={() => setDraft('Prüfe die Beziehungen und Timeline auf Lücken oder Widersprüche.')}>Timeline prüfen</button></div>}
      {entries.map(entry => <article className="assistant-exchange" key={entry.id}>
        <p className="assistant-question">{entry.question}</p>
        {entry.error && <div className="assistant-error"><span>{entry.error}</span><button disabled={sending} onClick={() => void send(entry.id)}><RotateCw />Erneut versuchen</button></div>}
        {entry.reply && <div className="assistant-answer"><p>{entry.reply.message}</p>
          {entry.reply.broadScope && <div className="assistant-broadscope"><div className="assistant-broadscope-actions">
            <button type="button" onClick={openChapterPicker}>Kapitel einzeln auswählen</button>
            <button type="button" disabled={sending} onClick={() => void send(entry.id, { batch: true })}>In Kapitel-Gruppen ausführen</button>
          </div></div>}
          {!!entry.reply.sources?.length && <SourceList sources={entry.reply.sources} onNavigate={onNavigate} />}
          {!!entry.reply.proposals?.length && <div className="assistant-proposals"><div className="assistant-proposal-heading"><strong>{entry.reply.proposals.length} Vorschläge</strong><button disabled={entry.applied.length === entry.reply.proposals.length} onClick={() => { const pending = entry.reply!.proposals.map((proposal, index) => ({ proposal, index })).filter(item => !entry.applied.includes(item.index)); apply(entry.id, pending.map(item => item.proposal), pending.map(item => item.index)); }}><Check />Alle übernehmen</button></div>
            {entry.reply.proposals.map((proposal, index) => { const grouped = (entry.reply?.proposalGroup?.proposalIndexes.length || 0) > 1; return <div className={`assistant-proposal ${entry.applied.includes(index) ? 'is-applied' : ''}`} key={index}><span>{proposalLabel(proposal, figures)}</span><button disabled={entry.applied.includes(index) || grouped} title={grouped ? 'Dieser Vorschlag gehört zu einem atomaren Paket und wird nur gemeinsam übernommen.' : undefined} onClick={() => apply(entry.id, [proposal], [index])}>{entry.applied.includes(index) ? <><Check />Übernommen</> : grouped ? 'Im Paket' : 'Übernehmen'}</button></div>; })}
          </div>}
          {!!entry.reply.agentTrace?.length && <details className="assistant-trace"><summary><ChevronDown />Ablauf ({entry.reply.agentTrace.length} Schritte)</summary><pre>{JSON.stringify(entry.reply.agentTrace, null, 2)}</pre></details>}
        </div>}
      </article>)}
      {sending && batchProgress && <div className="assistant-progress">
        <span>{batchProgress.label || 'Kapitel-Gruppen werden verarbeitet …'} {batchProgress.total ? `(${batchProgress.done}/${batchProgress.total})` : ''}</span>
        <div className="assistant-progress-bar"><span style={{ width: `${batchProgress.total ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}%` }} /></div>
      </div>}
      {sending && !batchProgress && <div className="assistant-thinking"><span /><span /><span />Quiltor durchsucht deine Welt …</div>}
      <div ref={end} />
    </div>
    <footer>
      {!!chapters.length && <details className="assistant-chapter-picker" ref={chapterPickerRef}>
        <summary><ChevronDown />{forcedChapterIds.length ? `Kontext: ${forcedChapterIds.length} Kapitel erzwungen` : 'Kontext: gesamte Welt'}</summary>
        <div className="assistant-chapter-picker-list">
          {chapters.map((chapter, index) => <label key={chapter.id}>
            <input type="checkbox" checked={forcedChapterIds.includes(chapter.id)}
              onChange={() => setForcedChapterIds(current => current.includes(chapter.id) ? current.filter(id => id !== chapter.id) : [...current, chapter.id])} />
            <span>{index + 1}. {chapter.title || 'Ohne Titel'}</span>
          </label>)}
          {!!forcedChapterIds.length && <button type="button" onClick={() => setForcedChapterIds([])}>Auswahl zurücksetzen</button>}
        </div>
      </details>}
      <label><span className="sr-only">Nachricht an den lokalen Assistenten</span><textarea value={draft} disabled={sending || status?.available === false} placeholder="Figur anlegen, Beziehung ändern, Timeline prüfen …" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /></label>
      {sending ? <button aria-label="Anfrage abbrechen" onClick={cancel}><Square /></button>
        : <button aria-label="Nachricht senden" disabled={!draft.trim() || status?.available === false} onClick={() => void send()}><ArrowUp /></button>}
      <small><BookOpen />Manuskript ist nur lesbarer Kontext. Änderungen werden nie automatisch angewendet.</small></footer>
    {confirmNewChat && <ConfirmDialog title="Neuer Chat" description="Der aktuelle Gesprächsverlauf wird gelöscht. Das kann nicht rückgängig gemacht werden." confirmLabel="Neuer Chat starten" onConfirm={() => setEntries([])} onClose={() => setConfirmNewChat(false)} />}
  </aside>;
}

function SourceList({ sources, onNavigate }: { sources: AssistantSource[]; onNavigate: (target: { workspace: Workspace; id: string }) => void }) {
  return <div className="assistant-sources"><span>Quellen</span>{sources.map(source => <button key={source.id} title={source.text} onClick={() => onNavigate(source.target)}>{source.title}</button>)}</div>;
}
