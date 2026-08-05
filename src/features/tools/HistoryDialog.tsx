import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { CommitInfo } from '../../types';
import { Dialog } from '../../shared/ui/Dialog';
import { AiActivity } from './AiActivity';

export function HistoryDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const [tab, setTab] = useState<'changes' | 'ai'>('changes');
  const [commits, setCommits] = useState<CommitInfo[]>([]), [selected, setSelected] = useState('WORK'), [diff, setDiff] = useState('Lade …'), [word, setWord] = useState(true), [all, setAll] = useState(false);
  useEffect(() => { void flush().then(api.log).then(result => setCommits(result.commits)); }, [flush]);
  useEffect(() => { setDiff('Lade …'); void api.diff(selected, word, all).then(result => setDiff(result.diff || (result.neu?.length ? `Neue Dateien:\n${result.neu.join('\n')}` : 'Keine Änderungen'))).catch(error => setDiff(String(error))); }, [selected, word, all]);
  return <Dialog title="Verlauf" onClose={onClose} wide>
    <div className="history-tabs" role="tablist"><button role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>Änderungen</button><button role="tab" aria-selected={tab === 'ai'} className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}>KI-Aktivität</button></div>
    {tab === 'ai' ? <AiActivity /> : <>
      <div className="history-toolbar"><span>Vergleich</span><div><button aria-pressed={word} onClick={() => setWord(!word)}>{word ? 'Wortweise' : 'Zeilenweise'}</button><button aria-pressed={all} onClick={() => setAll(!all)}>{all ? 'Alle Dateien' : 'Nur Text'}</button></div></div>
      <div className="history-layout"><nav aria-label="Stände"><button className={selected === 'WORK' ? 'active' : ''} onClick={() => setSelected('WORK')}><strong>Seit letztem Commit</strong><small>Arbeitsstand</small></button>{commits.map(commit => <button key={commit.hash} className={selected === commit.hash ? 'active' : ''} onClick={() => setSelected(commit.hash)}><strong>{commit.betreff}</strong><small>{commit.kurz} · {commit.datum}</small></button>)}</nav><div className="diff-view">{diff.split('\n').map((line, index) => <div key={index} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : line.startsWith('diff ') ? 'diff-file' : ''}>{word ? markWords(line) : line}</div>)}</div></div>
    </>}
  </Dialog>;
}

function markWords(line: string) {
  return line.split(/(\[-.*?-\]|\{\+.*?\+\})/g).map((part, index) => part.startsWith('[-') ? <del key={index}>{part.slice(2, -2)}</del> : part.startsWith('{+') ? <ins key={index}>{part.slice(2, -2)}</ins> : part);
}
