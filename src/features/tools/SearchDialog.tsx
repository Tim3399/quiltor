import { useMemo, useState } from 'react';
import { Command, FileText, MapPin, Search, UserRound } from 'lucide-react';
import type { FigureState, Manuscript, Workspace } from '../../types';
import { Dialog } from '../../shared/ui/Dialog';

export function SearchDialog({ manuscript, figures, onClose, onWorkspace, onSelect, onCommand }: { manuscript: Manuscript; figures: FigureState; onClose: () => void; onWorkspace: (value: Workspace) => void; onSelect: (target: { workspace: Workspace; id: string }) => void; onCommand: (command: string) => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('de-DE'); if (!term) return [];
    const chapters = manuscript.chapters.filter(c => `${c.title}\n${c.body}\n${c.note}`.toLocaleLowerCase('de-DE').includes(term)).map(c => ({ id: c.id, kind: 'Kapitel', title: c.title || 'Ohne Titel', detail: c.body.slice(0, 120), workspace: 'text' as const }));
    const nodes = figures.nodes.filter(n => JSON.stringify(n).toLocaleLowerCase('de-DE').includes(term)).map(n => ({ id: n.id, kind: n.type === 'ort' ? 'Ort' : n.type === 'konzept' ? 'Konzept' : 'Figur', title: n.name, detail: n.sub || n.label || '', workspace: 'figures' as const }));
    return [...chapters, ...nodes];
  }, [query, manuscript, figures]);
  const commands = [{ id: 'text', title: 'Zum Manuskript wechseln' }, { id: 'figures', title: 'Zum Figurenboard wechseln' }, { id: 'focus', title: 'Fokusmodus umschalten' }, { id: 'history', title: 'Verlauf öffnen' }, { id: 'git', title: 'Git öffnen' }, { id: 'backups', title: 'Sicherungen öffnen' }].filter(item => !query || item.title.toLocaleLowerCase('de-DE').includes(query.toLocaleLowerCase('de-DE')));
  return <Dialog title="Suchen & Befehle" onClose={onClose} wide>
    <label className="search-input"><Search /><span className="sr-only">Suchbegriff</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Kapitel, Text, Figuren, Orte …" /></label>
    <div className="search-results"><div className="result-section">Befehle</div>{commands.map(item => <button key={item.id} onClick={() => { onCommand(item.id); onClose(); }}><Command /><span><small>Befehl</small><strong>{item.title}</strong></span></button>)}{query && <div className="result-section">Inhalte</div>}{query && !results.length ? <p className="empty-message">Keine Inhaltstreffer für „{query}“</p> : results.map(result => <button key={`${result.workspace}-${result.id}`} onClick={() => { onWorkspace(result.workspace); onSelect({ workspace: result.workspace, id: result.id }); onClose(); }}>
      {result.kind === 'Kapitel' ? <FileText /> : result.kind === 'Ort' ? <MapPin /> : <UserRound />}<span><small>{result.kind}</small><strong>{result.title}</strong><em>{result.detail}</em></span>
    </button>)}</div>
  </Dialog>;
}
