import { DatabaseBackup, GitBranch, History, Search, Sparkles, Users, FileText, Command, Moon, Sun } from 'lucide-react';
import type { Theme } from '../hooks/useTheme';
import type { SavePhase, Workspace } from '../types';
import { SaveStatus } from '../shared/ui/SaveStatus';
import { PRODUCT_NAME } from '../config/branding';

export function AppShell({ title, workspace, onWorkspace, phase, error, retry, theme, onTheme, onSearch, onHistory, onGit, onBackups, onAssistant, children }: {
  title: string; workspace: Workspace; onWorkspace: (value: Workspace) => void; phase: SavePhase; error?: string; retry: () => void; theme: Theme; onTheme: () => void;
  onSearch: () => void; onHistory: () => void; onGit: () => void; onBackups: () => void; onAssistant: () => void; children: React.ReactNode;
}) {
  return <div className="app-frame" data-workspace={workspace}>
    <header className="app-bar">
      <div className="brand" title={`${title} · ${PRODUCT_NAME}`}><span>{title}</span><small>{PRODUCT_NAME}</small></div>
      <nav className="workspace-switch" aria-label="Arbeitsbereich">
        <button aria-current={workspace === 'text' ? 'page' : undefined} onClick={() => onWorkspace('text')}><FileText />Text</button>
        <button aria-current={workspace === 'figures' ? 'page' : undefined} onClick={() => onWorkspace('figures')}><Users />Figuren</button>
      </nav>
      <div className="global-actions" role="toolbar" aria-label="Globale Werkzeuge">
        <button onClick={onAssistant} aria-label="Lokalen Assistenten öffnen" title="Lokaler Assistent"><Sparkles /><span>Assistent</span></button>
        <button onClick={onSearch} aria-label="Suche öffnen" title="Suche"><Search /><span>Suche</span><kbd>⌘ F</kbd></button>
        <button onClick={onHistory} aria-label="Verlauf öffnen" title="Verlauf"><History /><span>Verlauf</span></button>
        <button onClick={onGit} aria-label="Git öffnen" title="Git"><GitBranch /><span>Git</span></button><button onClick={onBackups} aria-label="Sicherungen öffnen" title="Sicherungen"><DatabaseBackup /><span>Sicherungen</span></button>
        <button onClick={onTheme} aria-label={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'} title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}>{theme === 'dark' ? <Sun /> : <Moon />}<span>{theme === 'dark' ? 'Hell' : 'Dunkel'}</span></button>
        <button className="command-hint" onClick={onSearch} title="Befehlssuche" aria-label="Befehlssuche öffnen"><Command /><kbd>⌘ K</kbd></button>
      </div>
      <SaveStatus phase={phase} error={error} onRetry={retry} />
    </header>
    <main className="workspace">{children}</main>
  </div>;
}
