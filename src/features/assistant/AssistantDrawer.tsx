import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Bot, Check, ChevronDown, Database, Download, Plus, RotateCw, Sparkles, Square, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { AssistantProposal, AssistantReply, AssistantSource, Chapter, FigureState, Workspace } from '../../types';
import type { MessageKey } from '../../language';
import { proposalLabel, scopeAssistantProposals } from './proposals';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Inspector } from '../../shared/ui/Sidebar';
import { Sheet } from '../../shared/ui/Sheet';
import { useLanguage } from '../../language';
import type { Translate } from '../../language';

const STATUS_POLL_MS = 15000;
const BATCH_PROGRESS_POLL_MS = 1500;

type Entry = { id: string; question: string; reply?: AssistantReply; error?: string; applied: number[] };

export function AssistantDrawer({ worldId, figures, chapters, open, onApply, onNavigate, onClose }: {
  worldId: string; figures: FigureState; chapters: Chapter[]; open: boolean; onApply: (proposals: AssistantProposal[]) => void;
  onNavigate: (target: { workspace: Workspace; id: string }) => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const storageKey = `quiltor-assistant:${worldId}`;
  const [entries, setEntries] = useState<Entry[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; } });
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ available: boolean; reason: string; installed: boolean; chunks: number } | null>(null);
  const [installState, setInstallState] = useState<{ running: boolean; phase: string; percent: number; error: string } | null>(null);
  const installPollRef = useRef<number | undefined>(undefined);
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [forcedChapterIds, setForcedChapterIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ total: number; done: number; labelKey?: MessageKey; labelParams?: Record<string, string | number> } | null>(null);
  const [compact, setCompact] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 719px)').matches);
  const end = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chapterPickerRef = useRef<HTMLDetailsElement>(null);
  const openChapterPicker = () => { const el = chapterPickerRef.current; if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } };
  const checkStatus = useCallback(() => {
    api.assistantStatus().then(setStatus).catch(error => setStatus({ available: false, reason: errorMessage(error), installed: false, chunks: 0 }));
  }, []);
  useEffect(() => {
    checkStatus();
    const interval = window.setInterval(checkStatus, STATUS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [checkStatus]);
  // An install keeps running server-side regardless of whether this drawer is open --
  // pollInstall() re-syncs with that real state (not just after clicking the button),
  // so closing and reopening the drawer mid-install shows the actual progress instead
  // of resetting to the "set up now" button. hadRunningRef tracks whether *this*
  // component instance actually saw (or triggered) a real install, so a plain mount
  // where nothing is installing doesn't force an extra, unrelated status re-check.
  const hadRunningRef = useRef(false);
  const pollInstall = useCallback(() => {
    api.assistantInstallStatus().then(state => {
      setInstallState(state);
      if (state.running) {
        hadRunningRef.current = true;
        if (!installPollRef.current) installPollRef.current = window.setInterval(pollInstall, 1000);
      } else {
        window.clearInterval(installPollRef.current);
        installPollRef.current = undefined;
        if (hadRunningRef.current) {
          hadRunningRef.current = false;
          checkStatus();
        }
      }
    }).catch(() => {});
  }, [checkStatus]);
  useEffect(() => { pollInstall(); }, [pollInstall]);
  const startInstall = () => {
    setInstallState({ running: true, phase: '', percent: 0, error: '' });
    void api.assistantInstall().then(() => { hadRunningRef.current = true; pollInstall(); });
  };
  useEffect(() => () => window.clearInterval(installPollRef.current), []);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(entries.slice(-40))); end.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries, storageKey]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(max-width: 719px)'), update = () => setCompact(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const send = async (retryId?: string, opts?: { batch?: boolean }, explicitQuestion?: string) => {
    const question = explicitQuestion || (retryId ? entries.find(entry => entry.id === retryId)?.question : draft.trim());
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
        ...(entry.reply ? [{ role: 'assistant' as const, content: resolveAssistantMessage(entry.reply, t), references: replyReferences(entry.reply) }] : []),
      ]);
      const batch = opts?.batch ? { runBatches: true, progressId: crypto.randomUUID() } : undefined;
      if (batch) {
        setBatchProgress({ total: 0, done: 0 });
        progressInterval = window.setInterval(() => {
          api.assistantProgress(batch.progressId).then(res => { if (res.progress) setBatchProgress(res.progress); }).catch(() => {});
        }, BATCH_PROGRESS_POLL_MS);
      }
      const response = await api.assistantChat(question, history, controller.signal, forcedChapterIds.length ? forcedChapterIds : undefined, batch);
      const reply = { ...response, proposals: scopeAssistantProposals(response.proposals || [], id) };
      setEntries(current => current.map(entry => entry.id === id ? { ...entry, reply } : entry));
    } catch (error) {
      const message = controller.signal.aborted ? t('requestAborted') : errorMessage(error);
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
  const content = <>
    <header><div><Sparkles /><span><strong>{t('assistant')}</strong><small>{t('localOnlySuggestions')}</small></span></div>
      <div className="assistant-header-actions">
        <button className="icon-button" disabled={!entries.length} aria-label={t('newChat')} title={t('newChat')} onClick={() => setConfirmNewChat(true)}><Plus /></button>
        <button className="icon-button" aria-label={t('closeAssistant')} onClick={onClose}><X /></button>
      </div>
    </header>
    <div className="assistant-scope"><Database /><span><strong>{t('sourcesIndexed').replace('{n}', String(status?.chunks ?? '…'))}</strong><small>{t('sourcesScopeDescription')}</small></span></div>
    {status && !status.available && <div className="assistant-offline" role="alert"><Bot /><div><strong>{t('localModelUnavailable')}</strong><p>{status.reason}</p>
      {installState?.running
        ? <div className="assistant-progress"><span>{t('installingAssistant').replace('{percent}', String(installState.percent))}</span><div className="assistant-progress-bar"><span style={{ width: `${installState.percent}%` }} /></div></div>
        : status.installed
          ? <button onClick={checkStatus}><RotateCw />{t('retry')}</button>
          : <button onClick={startInstall}><Download />{t('installAssistant')}</button>}
      {installState?.error && <p className="error-box" role="alert">{t('installAssistantError').replace('{error}', installState.error)}</p>}
    </div></div>}
    <div className="assistant-messages">
      {!entries.length && <div className="assistant-empty"><Bot /><h2>{t('assistantGreeting')}</h2><p>{t('assistantGreetingBody')}</p><button onClick={() => setDraft(t('findMissingFiguresPrompt'))}>{t('findMissingFigures')}</button><button onClick={() => setDraft(t('checkTimelinePrompt'))}>{t('checkTimeline')}</button></div>}
      {entries.map(entry => <article className="assistant-exchange" key={entry.id}>
        <p className="assistant-question">{entry.question}</p>
        {entry.error && <div className="assistant-error" role="alert"><span>{entry.error}</span><button disabled={sending} onClick={() => void send(entry.id)}><RotateCw />{t('retry')}</button></div>}
        {entry.reply && <div className="assistant-answer"><p>{resolveAssistantMessage(entry.reply, t)}</p>
          {!!entry.reply.clarification?.candidates.length && <div className="assistant-broadscope"><div className="assistant-broadscope-actions">
            {entry.reply.clarification.candidates.map(candidate => <button type="button" disabled={sending} key={candidate.id} onClick={() => void send(undefined, undefined, `${t('whichElementDoYouMean')} ${candidate.name} [${candidate.id}]`)}>{candidate.name}</button>)}
          </div></div>}
          {entry.reply.broadScope && <div className="assistant-broadscope"><div className="assistant-broadscope-actions">
            <button type="button" onClick={openChapterPicker}>{t('pickChaptersIndividually')}</button>
            <button type="button" disabled={sending} onClick={() => void send(entry.id, { batch: true })}>{t('runInChapterGroups')}</button>
          </div></div>}
          {!!entry.reply.sources?.length && <SourceList sources={entry.reply.sources} onNavigate={onNavigate} />}
          {!!entry.reply.proposals?.length && <details className="assistant-proposals" open><summary className="assistant-proposal-heading"><span><ChevronDown /><strong>{t('nProposals').replace('{n}', String(entry.reply.proposals.length))}</strong></span><button disabled={entry.applied.length === entry.reply.proposals.length} onClick={event => { event.preventDefault(); const pending = entry.reply!.proposals.map((proposal, index) => ({ proposal, index })).filter(item => !entry.applied.includes(item.index)); apply(entry.id, pending.map(item => item.proposal), pending.map(item => item.index)); }}><Check />{t('applyAll')}</button></summary>
            {entry.reply.proposals.map((proposal, index) => { const grouped = (entry.reply?.proposalGroup?.proposalIndexes.length || 0) > 1; return <div className={`assistant-proposal ${entry.applied.includes(index) ? 'is-applied' : ''}`} key={index}><span>{proposalLabel(proposal, figures, t)}</span><button disabled={entry.applied.includes(index) || grouped} title={grouped ? t('packageOnlyTogetherHelp') : undefined} onClick={() => apply(entry.id, [proposal], [index])}>{entry.applied.includes(index) ? <><Check />{t('applied')}</> : grouped ? t('inPackage') : t('apply')}</button></div>; })}
          </details>}
          {!!entry.reply.agentTrace?.length && <details className="assistant-trace"><summary><ChevronDown />{t('agentTraceSteps').replace('{n}', String(entry.reply.agentTrace.length))}</summary><pre>{JSON.stringify(entry.reply.agentTrace, null, 2)}</pre></details>}
        </div>}
      </article>)}
      {sending && batchProgress && <div className="assistant-progress">
        <span>{batchProgress.labelKey ? t(batchProgress.labelKey, batchProgress.labelParams) : t('processingChapterGroups')} {batchProgress.total ? `(${batchProgress.done}/${batchProgress.total})` : ''}</span>
        <div className="assistant-progress-bar"><span style={{ width: `${batchProgress.total ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}%` }} /></div>
      </div>}
      {sending && !batchProgress && <div className="assistant-thinking"><span /><span /><span />{t('assistantSearchingWorld')}</div>}
      <div ref={end} />
    </div>
    <footer>
      {!!chapters.length && <details className="assistant-chapter-picker" ref={chapterPickerRef}>
        <summary><ChevronDown />{forcedChapterIds.length ? t('contextNChaptersForced').replace('{n}', String(forcedChapterIds.length)) : t('contextEntireWorld')}</summary>
        <div className="assistant-chapter-picker-list">
          {chapters.map((chapter, index) => <label key={chapter.id}>
            <input type="checkbox" checked={forcedChapterIds.includes(chapter.id)}
              onChange={() => setForcedChapterIds(current => current.includes(chapter.id) ? current.filter(id => id !== chapter.id) : [...current, chapter.id])} />
            <span>{index + 1}. {chapter.title || t('untitled')}</span>
          </label>)}
          {!!forcedChapterIds.length && <button type="button" onClick={() => setForcedChapterIds([])}>{t('resetSelection')}</button>}
        </div>
      </details>}
      <label><span className="sr-only">{t('messageToAssistantLabel')}</span><textarea value={draft} disabled={sending || status?.available === false} placeholder={t('messagePlaceholder')} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /></label>
      {sending ? <button aria-label={t('cancelRequest')} onClick={cancel}><Square /></button>
        : <button aria-label={t('sendMessage')} disabled={!draft.trim() || status?.available === false} onClick={() => void send()}><ArrowUp /></button>}
      <small><BookOpen />{t('manuscriptReadOnlyNote')}</small></footer>
    {confirmNewChat && <ConfirmDialog title={t('newChat')} description={t('newChatConfirmDescription')} confirmLabel={t('startNewChat')} onConfirm={() => setEntries([])} onClose={() => setConfirmNewChat(false)} />}
  </>;
  const className = `assistant-drawer ${status && !status.available ? 'has-offline' : ''}`;
  // Stays mounted while closed (App.tsx renders this once assistantEverOpened,
  // regardless of `open`) so in-flight requests, the sending indicator, and install
  // progress survive closing the panel -- only the visible markup is gated on `open`.
  return compact
    ? <Sheet open={open} label={t('localAssistant')} onClose={onClose}><div className={className}>{content}</div></Sheet>
    : open ? <Inspector className={className} aria-label={t('localAssistant')}>{content}</Inspector> : null;
}

function SourceList({ sources, onNavigate }: { sources: AssistantSource[]; onNavigate: (target: { workspace: Workspace; id: string }) => void }) {
  const { t } = useLanguage();
  return <details className="assistant-sources"><summary><ChevronDown />{t('sources')} · {sources.length}</summary><div>{sources.map(source => <button key={source.id} title={source.text} onClick={() => onNavigate(source.target)}>{source.title}</button>)}</div></details>;
}

// Deterministic backend replies carry a messageKey/messageParams/messageItems triple
// instead of literal text (see AssistantReply in types.ts) -- messageItems are individually
// translated sub-messages (e.g. audit findings) joined into the template's {items}
// placeholder. `message` remains the fallback for genuinely free-form LLM-authored text.
function resolveAssistantMessage(reply: AssistantReply, t: Translate): string {
  const base = reply.messageKey
    ? t(reply.messageKey, { ...reply.messageParams, ...(reply.messageItems ? { items: reply.messageItems.map(item => t(item.key, item.params)).join('; ') } : {}) })
    : reply.message;
  return reply.messageNoteKey ? `${base}\n\n${t(reply.messageNoteKey)}` : base;
}

function replyReferences(reply: AssistantReply): string[] {
  const targets = (reply.proposals || []).flatMap(proposal => {
    if (proposal.kind === 'create_element' || proposal.kind === 'create_timeline_moment') return [proposal.tempId];
    if (proposal.kind === 'update_element' || proposal.kind === 'mark_deceased') return [proposal.elementId];
    if (proposal.kind === 'set_presence') return [proposal.elementId, proposal.placeId, ...(proposal.momentId ? [proposal.momentId] : [])];
    if (proposal.kind === 'create_relationship') return [proposal.relationship.from, proposal.relationship.to];
    if (proposal.kind === 'set_relationship_at_moment') return [proposal.relationshipId, proposal.momentId];
    return [];
  });
  return [...new Set([...(reply.sources || []).map(source => source.id), ...targets])];
}
