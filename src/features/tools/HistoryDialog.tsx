import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { CommitInfo } from '../../types';
import { Sheet } from '../../shared/ui/Sheet';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';
import { useLanguage } from '../../language';

export function HistoryDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const { t } = useLanguage();
  const [commits, setCommits] = useState<CommitInfo[]>([]), [selected, setSelected] = useState('WORK'), [diff, setDiff] = useState(t('loading')), [word, setWord] = useState(true), [all, setAll] = useState(false);
  useFlushedEffect(flush, () => api.log().then(result => setCommits(result.commits)));
  useEffect(() => { setDiff(t('loading')); void api.diff(selected, word, all).then(result => setDiff(result.diff || (result.neu?.length ? `${t('newFiles')}\n${result.neu.join('\n')}` : t('noChanges')))).catch(error => setDiff(errorMessage(error))); }, [selected, word, all, t]);
  return <Sheet open label={t('history')} onClose={onClose} wide><div className="utility-sheet"><header><h2>{t('history')}</h2><button className="icon-button" aria-label={t('closeDialog')} onClick={onClose}><X /></button></header><div className="utility-sheet-content">
    <div className="history-toolbar"><span>{t('comparison')}</span><div><button aria-pressed={word} onClick={() => setWord(!word)}>{word ? t('byWord') : t('byLine')}</button><button aria-pressed={all} onClick={() => setAll(!all)}>{all ? t('allFiles') : t('textOnly')}</button></div></div>
    <div className="history-layout"><nav aria-label={t('states')}><button className={selected === 'WORK' ? 'active' : ''} onClick={() => setSelected('WORK')}><strong>{t('sinceCommit')}</strong><small>{t('workingState')}</small></button>{commits.map(commit => <button key={commit.hash} className={selected === commit.hash ? 'active' : ''} onClick={() => setSelected(commit.hash)}><strong>{commit.betreff}</strong><small>{commit.kurz} · {commit.datum}</small></button>)}</nav><div className="diff-view">{diff.split('\n').map((line, index) => <div key={index} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : line.startsWith('diff ') ? 'diff-file' : ''}>{word ? markWords(line) : line}</div>)}</div></div>
  </div></div></Sheet>;
}

function markWords(line: string) {
  return line.split(/(\[-.*?-\]|\{\+.*?\+\})/g).map((part, index) => part.startsWith('[-') ? <del key={index}>{part.slice(2, -2)}</del> : part.startsWith('{+') ? <ins key={index}>{part.slice(2, -2)}</ins> : part);
}
