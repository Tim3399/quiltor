import { Clock3, DatabaseBackup, GitBranch, History, LogOut, MapPin, Search, Sparkles, Users, FileText, Command, Moon, Sun } from 'lucide-react';
import type { Theme } from '../hooks/useTheme';
import type { SavePhase, Workspace } from '../types';
import { SaveStatus } from '../shared/ui/SaveStatus';
import { PRODUCT_NAME } from '../config/branding';
import { useLanguage } from '../language';

export function AppShell({ title, workspace, onWorkspace, phase, error, retry, theme, onTheme, onSearch, onCommands, onHistory, onGit, onBackups, onAssistant, whoami, onLogout, version, children }: {
  title: string; workspace: Workspace; onWorkspace: (value: Workspace) => void; phase: SavePhase; error?: string; retry: () => void; theme: Theme; onTheme: () => void;
  onSearch: () => void; onCommands: () => void; onHistory: () => void; onGit: () => void; onBackups: () => void; onAssistant: () => void;
  whoami?: { email?: string; name?: string } | null; onLogout?: () => void; version?: string; children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return <div className="app-frame" data-workspace={workspace}>
    <header className="app-bar">
      <div className="brand" title={`${title} · ${PRODUCT_NAME}${version ? ` v${version}` : ''}`}><span>{title}</span><small>{PRODUCT_NAME}{version && ` · v${version}`}</small></div>
      <nav className="workspace-switch" aria-label={t('workspaceNav')}>
        <button aria-current={workspace === 'text' ? 'page' : undefined} onClick={() => onWorkspace('text')}><FileText />{t('text')}</button>
        <button aria-current={workspace === 'figures' ? 'page' : undefined} onClick={() => onWorkspace('figures')}><Users />{t('figures')}</button>
        <button aria-current={workspace === 'timeline' ? 'page' : undefined} onClick={() => onWorkspace('timeline')}><Clock3 />{t('timelineNav')}</button>
        <button aria-current={workspace === 'places' ? 'page' : undefined} onClick={() => onWorkspace('places')}><MapPin />{t('places')}</button>
      </nav>
      <div className="global-actions" role="toolbar" aria-label={t('globalTools')}>
        <button onClick={onAssistant} aria-label={t('openAssistant')} title={t('localAssistant')}><Sparkles /><span>{t('assistant')}</span></button>
        <button onClick={onSearch} aria-label={t('openSearch')} title={t('search')}><Search /><span>{t('search')}</span><kbd>⌘ F</kbd></button>
        <button onClick={onHistory} aria-label={t('openHistory')} title={t('history')}><History /><span>{t('history')}</span></button>
        <button onClick={onGit} aria-label={t('openGit')} title="Git"><GitBranch /><span>Git</span></button><button onClick={onBackups} aria-label={t('openBackups')} title={t('backups')}><DatabaseBackup /><span>{t('backups')}</span></button>
        <button onClick={onTheme} aria-label={theme === 'dark' ? t('enableLight') : t('enableDark')} title={theme === 'dark' ? t('lightDesign') : t('darkDesign')}>{theme === 'dark' ? <Sun /> : <Moon />}<span>{theme === 'dark' ? t('themeLightShort') : t('themeDarkShort')}</span></button>
        <button className="command-hint" onClick={onCommands} title={t('commandSearch')} aria-label={t('openCommands')}><Command /><kbd>⌘ K</kbd></button>
        {whoami && <button onClick={onLogout} aria-label={t('logout')} title={t('loggedInAs').replace('{name}', whoami.name || whoami.email || '')}><LogOut /><span>{whoami.name || whoami.email || t('logout')}</span></button>}
      </div>
      <SaveStatus phase={phase} error={error} onRetry={retry} />
    </header>
    <main className="workspace">{children}</main>
  </div>;
}
