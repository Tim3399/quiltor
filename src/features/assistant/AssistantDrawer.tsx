import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Bot, Check, ChevronDown, Database, Plus, RotateCw, Sparkles, Square, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { AssistantProposal, AssistantReply, AssistantSource, Chapter, FigureState, Workspace } from '../../types';
import { proposalLabel, scopeAssistantProposals } from './proposals';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

const STATUS_POLL_MS = 15000;

type Entry = { id: string; question: string; reply?: AssistantReply; error?: string; applied: number[]; progressId?: string };

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
  const [progress, setProgress] = useState<{ total: number; done: number; label: string; etaSeconds?: number } | null>(null);
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
  const send = async (retryId?: string, opts?: { batch?: boolean; resolutions?: Record<string, string> }) => {
    const question = retryId ? entries.find(entry => entry.id === retryId)?.question : draft.trim();
    if (!question || sending) return;
    const id = retryId ?? crypto.randomUUID();
    // Every request gets a progress id and is polled, not just batch mode: a single request
    // can fire several LLM runs (plan, propose, repair, deterministic extraction) and the
    // backend reports which step is active so it can be shown live. It's also stored on the
    // entry (and so persisted) so a reload mid-request can reconnect and recover the answer.
    const progressId = crypto.randomUUID();
    // Re-sending an entry (retry or a clarification answer) clears its previous reply/error so
    // the live step indicator shows again instead of the stale answer.
    if (retryId) setEntries(current => current.map(entry => entry.id === id ? { ...entry, error: undefined, reply: undefined, progressId } : entry));
    else { setDraft(''); setEntries(current => [...current, { id, question, applied: [], progressId }]); }
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ total: 0, done: 0, label: '' });
    const progressInterval = window.setInterval(() => {
      api.assistantProgress(progressId).then(res => { if (res.progress) setProgress(res.progress); }).catch(() => {});
    }, opts?.batch ? 1200 : 500);
    try {
      // Send the whole (locally capped) transcript -- the backend picks however much
      // actually fits the model's real token budget (backend/assistant.py's
      // conversation_messages), so there's no need to pre-guess a turn count here.
      const history = entries.filter(entry => entry.id !== id).flatMap(entry => [
        { role: 'user' as const, content: entry.question },
        ...(entry.reply ? [{ role: 'assistant' as const, content: entry.reply.message }] : []),
      ]);
      const response = await api.assistantChat(question, history, {
        signal: controller.signal,
        chapterIds: forcedChapterIds.length ? forcedChapterIds : undefined,
        runBatches: opts?.batch,
        progressId,
        resolutions: opts?.resolutions,
      });
      const reply = { ...response, proposals: scopeAssistantProposals(response.proposals || [], id) };
      setEntries(current => current.map(entry => entry.id === id ? { ...entry, reply, progressId: undefined } : entry));
    } catch (error) {
      const message = controller.signal.aborted ? 'Anfrage abgebrochen.' : error instanceof Error ? error.message : String(error);
      setEntries(current => current.map(entry => entry.id === id ? { ...entry, error: message, progressId: undefined } : entry));
    } finally {
      setSending(false); abortRef.current = null;
      window.clearInterval(progressInterval);
      setProgress(null);
    }
  };
  // Recover a request that was still running when the page reloaded: poll its result by the
  // stored progress id and fill the answer in, so a long request's result isn't lost.
  const reconnect = async (entryId: string, progressId: string) => {
    setSending(true);
    setProgress({ total: 0, done: 0, label: 'Verbindung zur laufenden Anfrage …' });
    const controller = new AbortController();
    abortRef.current = controller;
    const progressInterval = window.setInterval(() => {
      api.assistantProgress(progressId).then(res => { if (res.progress) setProgress(res.progress); }).catch(() => {});
    }, 700);
    try {
      while (!controller.signal.aborted) {
        const res = await api.assistantResult(progressId);
        if (res.finished && res.result) {
          const reply = { ...res.result, proposals: scopeAssistantProposals(res.result.proposals || [], entryId) };
          setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, reply, progressId: undefined } : entry));
          return;
        }
        if (!res.ok) {
          setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, error: 'Die Anfrage lief noch, ihr Ergebnis ist nicht mehr abrufbar. Bitte erneut senden.', progressId: undefined } : entry));
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 1000));
      }
    } finally {
      setSending(false); abortRef.current = null;
      window.clearInterval(progressInterval); setProgress(null);
    }
  };
  const reconnectedRef = useRef(false);
  useEffect(() => {
    if (reconnectedRef.current) return;
    reconnectedRef.current = true;
    const pending = entries.find(entry => entry.progressId && !entry.reply && !entry.error);
    if (pending?.progressId) void reconnect(pending.id, pending.progressId);
    // Runs once on mount; entries here is the transcript restored from localStorage.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
          {entry.reply.clarification && <div className="assistant-broadscope"><p>{entry.reply.clarification.question}</p><div className="assistant-broadscope-actions">
            {entry.reply.clarification.candidates.map(candidate => <button key={candidate.id} type="button" disabled={sending}
              onClick={() => { const reference = entry.reply!.clarification!.reference; void send(entry.id, { resolutions: { [reference]: candidate.id } }); }}>
              {candidate.name}{candidate.similarity ? ` · ${Math.round(candidate.similarity * 100)}%` : ''}
            </button>)}
          </div></div>}
          {!!entry.reply.sources?.length && <SourceList sources={entry.reply.sources} onNavigate={onNavigate} />}
          {!!entry.reply.proposals?.length && <div className="assistant-proposals"><div className="assistant-proposal-heading"><strong>{entry.reply.proposals.length} Vorschläge</strong><button disabled={entry.applied.length === entry.reply.proposals.length} onClick={() => { const pending = entry.reply!.proposals.map((proposal, index) => ({ proposal, index })).filter(item => !entry.applied.includes(item.index)); apply(entry.id, pending.map(item => item.proposal), pending.map(item => item.index)); }}><Check />Alle übernehmen</button></div>
            {entry.reply.proposals.map((proposal, index) => { const grouped = (entry.reply?.proposalGroup?.proposalIndexes.length || 0) > 1; return <div className={`assistant-proposal ${entry.applied.includes(index) ? 'is-applied' : ''}`} key={index}><span>{proposalLabel(proposal, figures)}</span><button disabled={entry.applied.includes(index) || grouped} title={grouped ? 'Dieser Vorschlag gehört zu einem atomaren Paket und wird nur gemeinsam übernommen.' : undefined} onClick={() => apply(entry.id, [proposal], [index])}>{entry.applied.includes(index) ? <><Check />Übernommen</> : grouped ? 'Im Paket' : 'Übernehmen'}</button></div>; })}
          </div>}
          {!!entry.reply.agentTrace?.length && <details className="assistant-trace"><summary><ChevronDown />Ablauf ({entry.reply.agentTrace.length} Schritte)</summary><pre>{JSON.stringify(entry.reply.agentTrace, null, 2)}</pre></details>}
        </div>}
      </article>)}
      {sending && progress && progress.total > 0 && <div className="assistant-progress">
        <span>{progress.label || 'Kapitel-Gruppen werden verarbeitet …'} ({progress.done}/{progress.total}){formatEta(progress.etaSeconds) && <em> · {formatEta(progress.etaSeconds)}</em>}</span>
        <div className="assistant-progress-bar"><span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
      </div>}
      {sending && (!progress || progress.total === 0) && <div className="assistant-thinking"><span /><span /><span /><em>{progress?.label || 'Quiltor durchsucht deine Welt'} …</em></div>}
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

// Word-weighted, throughput-measured ETA from the backend (assistant.py's _Eta). Absent for
// the first group (no measured rate yet), so this returns '' and the UI shows none rather than
// a guess. Rounded to a friendly granularity -- this is an estimate, not a countdown.
function formatEta(seconds?: number): string {
  if (seconds == null || seconds < 0) return '';
  if (seconds < 45) return 'noch <1 min';
  return `noch ca. ${Math.round(seconds / 60)} min`;
}

function SourceList({ sources, onNavigate }: { sources: AssistantSource[]; onNavigate: (target: { workspace: Workspace; id: string }) => void }) {
  return <div className="assistant-sources"><span>Quellen</span>{sources.map(source => <button key={source.id} title={source.text} onClick={() => onNavigate(source.target)}>{source.title}</button>)}</div>;
}
