import { useMemo } from 'react';
import { Clock3, Command, FileText, MapPin, UserRound } from 'lucide-react';
import type { FigureState, Manuscript, Workspace } from '../../types';
import { CommandPalette, type CommandPaletteItem } from '../../shared/ui/CommandPalette';
import { kindLabel } from '../figures/relationships';
import { useLanguage } from '../../language';

export function SearchDialog({ manuscript, figures, onClose, onWorkspace, onSelect, onCommand }: { manuscript: Manuscript; figures: FigureState; onClose: () => void; onWorkspace: (value: Workspace) => void; onSelect: (target: { workspace: Workspace; id: string }) => void; onCommand: (command: string) => void }) {
  const { t } = useLanguage();
  const items = useMemo<CommandPaletteItem[]>(() => {
    const commands: CommandPaletteItem[] = [
      ['text', t('switchToManuscript')], ['figures', t('switchToFigures')], ['timeline', t('switchToTimeline')], ['places', t('switchToPlaces')],
      ['focus', t('toggleFocus')], ['history', t('openHistory')], ['git', t('openGit')], ['backups', t('openBackups')],
    ].map(([id, label]) => ({ id: `command-${id}`, label, detail: t('command'), icon: <Command />, onSelect: () => onCommand(id) }));
    const chapters: CommandPaletteItem[] = manuscript.chapters.map(chapter => ({ id: `chapter-${chapter.id}`, label: chapter.title || t('untitled'), detail: chapter.body.slice(0, 120), keywords: [chapter.body, chapter.note], icon: <FileText />, requiresQuery: true, onSelect: () => { onWorkspace('text'); onSelect({ workspace: 'text', id: chapter.id }); } }));
    const nodes: CommandPaletteItem[] = figures.nodes.map(node => ({ id: `node-${node.id}`, label: node.name, detail: node.sub || node.label || kindLabel(node.type ?? 'person', t), keywords: [JSON.stringify(node)], icon: node.type === 'ort' ? <MapPin /> : <UserRound />, requiresQuery: true, onSelect: () => { const targetWorkspace: Workspace = node.type === 'ort' ? 'places' : 'figures'; onWorkspace(targetWorkspace); onSelect({ workspace: targetWorkspace, id: node.id }); } }));
    const moments: CommandPaletteItem[] = (figures.timeline || []).map(moment => ({ id: `moment-${moment.id}`, label: moment.title, detail: moment.note || moment.date || t('momentKind'), keywords: [JSON.stringify(moment)], icon: <Clock3 />, requiresQuery: true, onSelect: () => { onWorkspace('timeline'); onSelect({ workspace: 'timeline', id: moment.id }); } }));
    return [...commands, ...chapters, ...nodes, ...moments];
  }, [manuscript.chapters, figures.nodes, figures.timeline, onCommand, onWorkspace, onSelect, t]);
  return <CommandPalette open label={t('searchCommands')} inputLabel={t('searchTerm')} placeholder={t('searchPlaceholder')} emptyLabel={t('noSearchResults')} items={items} onClose={onClose} />;
}
