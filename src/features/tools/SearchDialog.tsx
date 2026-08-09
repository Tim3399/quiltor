import { useMemo, useState } from 'react';
import { Clock3, Command, FileText, MapPin, Search, UserRound } from 'lucide-react';
import type { FigureState, Manuscript, Workspace } from '../../types';
import { Dialog } from '../../shared/ui/Dialog';
import { kindLabel } from '../figures/relationships';
import { useLanguage } from '../../language';

export function SearchDialog({ mode = 'search', manuscript, figures, onClose, onWorkspace, onSelect, onCommand }: { mode?: 'search' | 'commands'; manuscript: Manuscript; figures: FigureState; onClose: () => void; onWorkspace: (value: Workspace) => void; onSelect: (target: { workspace: Workspace; id: string }) => void; onCommand: (command: string) => void }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('de-DE'); if (!term) return [];
    const chapters = manuscript.chapters.filter(c => `${c.title}\n${c.body}\n${c.note}`.toLocaleLowerCase('de-DE').includes(term)).map(c => ({ id: c.id, kind: 'chapter' as const, title: c.title || t('untitled'), detail: c.body.slice(0, 120), workspace: 'text' as const }));
    const nodes = figures.nodes.filter(n => JSON.stringify(n).toLocaleLowerCase('de-DE').includes(term)).map(n => ({ id: n.id, kind: n.type ?? 'person' as const, title: n.name, detail: n.sub || n.label || '', workspace: n.type === 'ort' ? 'places' as const : 'figures' as const }));
    const moments = (figures.timeline || []).filter(moment => JSON.stringify(moment).toLocaleLowerCase('de-DE').includes(term)).map(moment => ({ id: moment.id, kind: 'moment' as const, title: moment.title, detail: moment.note || moment.date || '', workspace: 'timeline' as const }));
    return [...chapters, ...nodes, ...moments];
  }, [query, manuscript, figures, t]);
  const commands = [{ id: 'text', title: t('switchToManuscript') }, { id: 'figures', title: t('switchToFigures') }, { id: 'timeline', title: t('switchToTimeline') }, { id: 'places', title: t('switchToPlaces') }, { id: 'focus', title: t('toggleFocus') }, { id: 'history', title: t('openHistory') }, { id: 'git', title: t('openGit') }, { id: 'backups', title: t('openBackups') }].filter(item => !query || item.title.toLocaleLowerCase('de-DE').includes(query.toLocaleLowerCase('de-DE')));
  const resultLabel = (kind: typeof results[number]['kind']) => kind === 'chapter' ? t('chapter') : kind === 'moment' ? t('momentKind') : kindLabel(kind, t);
  return <Dialog title={mode === 'commands' ? t('commandSearch') : t('searchContent')} onClose={onClose} wide>
    <label className="search-input">{mode === 'commands' ? <Command /> : <Search />}<span className="sr-only">{mode === 'commands' ? t('command') : t('searchTerm')}</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'commands' ? t('commandPlaceholder') : t('searchPlaceholder')} /></label>
    <div className="search-results">{mode === 'commands' ? <><div className="result-section">{t('commands')}</div>{commands.map(item => <button key={item.id} onClick={() => onCommand(item.id)}><Command /><span><small>{t('command')}</small><strong>{item.title}</strong></span></button>)}</> : <>{query && <div className="result-section">{t('contents')}</div>}{query && !results.length ? <p className="empty-message">{t('noResultsFor').replace('{query}', query)}</p> : results.map(result => <button key={`${result.workspace}-${result.id}`} onClick={() => { onWorkspace(result.workspace); onSelect({ workspace: result.workspace, id: result.id }); onClose(); }}>
      {result.kind === 'chapter' ? <FileText /> : result.kind === 'ort' ? <MapPin /> : result.kind === 'moment' ? <Clock3 /> : <UserRound />}<span><small>{resultLabel(result.kind)}</small><strong>{result.title}</strong><em>{result.detail}</em></span>
    </button>)}</>}</div>
  </Dialog>;
}
