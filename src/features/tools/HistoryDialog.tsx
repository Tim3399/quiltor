import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { CommitInfo } from '../../types';
import { Sheet } from '../../shared/ui/Sheet';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';
import { useLanguage } from '../../language';
import type { Translate } from '../../language';
import { describePath, type PathKind } from '../../lib/gitNames';

interface DiffSegment { path: string; kind: PathKind; title: string; binary: boolean; lines: string[]; added: number; removed: number }

// Lines git prints purely for its own bookkeeping (blob hashes, file-mode markers, hunk
// headers) -- an author cares which chapter changed and how, not this plumbing.
const NOISE_RE = /^(index |--- |\+\+\+ |old mode|new mode|deleted file mode|new file mode|similarity index|rename from|rename to|copy from|copy to)/;
const GAP_MARK = '⋯';

function wordsIn(text: string) { return text.trim() ? text.trim().split(/\s+/).length : 0; }

function segmentStats(lines: string[], word: boolean) {
  let added = 0, removed = 0;
  for (const line of lines) {
    if (!word) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
      continue;
    }
    for (const match of line.matchAll(/\{\+(.*?)\+\}/g)) added += wordsIn(match[1]);
    for (const match of line.matchAll(/\[-(.*?)-\]/g)) removed += wordsIn(match[1]);
    if (line.startsWith('+')) added += wordsIn(line.slice(1));
    else if (line.startsWith('-')) removed += wordsIn(line.slice(1));
  }
  return { added, removed };
}

function parseDiff(text: string, word: boolean): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let current: { path: string; lines: string[]; hunks: number } | null = null;
  const finish = () => { if (current) segments.push(buildSegment(current, word)); };
  for (const line of text.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) { finish(); current = { path: header[2], lines: [], hunks: 0 }; continue; }
    if (!current) continue;
    if (/^@@/.test(line)) { current.hunks++; if (current.hunks > 1) current.lines.push(GAP_MARK); continue; }
    if (NOISE_RE.test(line)) continue;
    current.lines.push(line);
  }
  finish();
  return segments;
}

function buildSegment(raw: { path: string; lines: string[] }, word: boolean): DiffSegment {
  const { kind, title } = describePath(raw.path);
  const binary = raw.lines.some(line => line.startsWith('Binary files'));
  const lines = binary ? [] : raw.lines;
  const { added, removed } = binary ? { added: 0, removed: 0 } : segmentStats(lines, word);
  return { path: raw.path, kind, title, binary, lines, added, removed };
}

function kindLabel(kind: PathKind, t: Translate): string | null {
  if (kind === 'chapter') return t('chapter');
  if (kind === 'profile') return t('profile');
  if (kind === 'database') return t('database');
  return null;
}

export function HistoryDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const { t } = useLanguage();
  const [commits, setCommits] = useState<CommitInfo[]>([]), [selected, setSelected] = useState('WORK'), [word, setWord] = useState(true), [all, setAll] = useState(false);
  const [result, setResult] = useState<{ diff: string; empty: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useFlushedEffect(flush, () => api.log().then(value => setCommits(value.commits)));
  useEffect(() => {
    setResult(null);
    void api.diff(selected, word, all)
      .then(value => setResult({ diff: value.diff, empty: value.diff ? '' : (value.neu?.length ? `${t('newFiles')}:\n${value.neu.join('\n')}` : t('noChanges')) }))
      .catch(error => setResult({ diff: '', empty: errorMessage(error) }));
  }, [selected, word, all, t]);

  const segments = useMemo(() => (result?.diff ? parseDiff(result.diff, word) : []), [result, word]);
  useEffect(() => { setOpen(new Set(segments.length <= 2 ? segments.map(segment => segment.path) : [])); }, [segments]);
  const toggle = (path: string) => setOpen(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });

  return <Sheet open label={t('history')} onClose={onClose} wide><div className="utility-sheet"><header><h2>{t('history')}</h2><button className="icon-button" aria-label={t('closeDialog')} onClick={onClose}><X /></button></header><div className="utility-sheet-content">
    <div className="history-toolbar"><span>{t('comparison')}</span><div><button aria-pressed={word} onClick={() => setWord(!word)}>{word ? t('byWord') : t('byLine')}</button><button aria-pressed={all} onClick={() => setAll(!all)}>{all ? t('allFiles') : t('textOnly')}</button></div></div>
    <div className="history-layout"><nav aria-label={t('states')}><button className={selected === 'WORK' ? 'active' : ''} onClick={() => setSelected('WORK')}><strong>{t('sinceCommit')}</strong><small>{t('workingState')}</small></button>{commits.map(commit => <button key={commit.hash} className={selected === commit.hash ? 'active' : ''} onClick={() => setSelected(commit.hash)}><strong>{commit.betreff}</strong><small>{commit.kurz} · {commit.datum}</small></button>)}</nav>
      <div className="diff-view">
        {!result ? <p className="empty-message">{t('loading')}</p> : segments.length === 0 ? <p className="empty-message">{result.empty || t('noChanges')}</p> : <>
          <ul className="diff-summary">{segments.map(segment => <li key={segment.path}><button aria-expanded={open.has(segment.path)} onClick={() => toggle(segment.path)}>
            {kindLabel(segment.kind, t) && <span className="diff-kind">{kindLabel(segment.kind, t)}</span>}
            <span className="diff-summary-title">{segment.title}</span>
            {!segment.binary && <span className="diff-stat">{t(word ? 'statWords' : 'statLines', { added: segment.added, removed: segment.removed })}</span>}
          </button></li>)}</ul>
          {segments.filter(segment => open.has(segment.path)).map(segment => <section key={segment.path} className="diff-segment">
            <h3>{kindLabel(segment.kind, t) ? `${kindLabel(segment.kind, t)} · ${segment.title}` : segment.title}</h3>
            {segment.binary ? <p className="diff-note">{t('binaryChange')}</p> : segment.lines.map((line, index) => line === GAP_MARK
              ? <div key={index} className="diff-gap">{GAP_MARK}</div>
              : <div key={index} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : ''}>{word ? markWords(line) : line}</div>)}
          </section>)}
        </>}
      </div>
    </div>
  </div></div></Sheet>;
}

function markWords(line: string) {
  return line.split(/(\[-.*?-\]|\{\+.*?\+\})/g).map((part, index) => part.startsWith('[-') ? <del key={index}>{part.slice(2, -2)}</del> : part.startsWith('{+') ? <ins key={index}>{part.slice(2, -2)}</ins> : part);
}
