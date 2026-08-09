import { useCallback, useRef, useState } from 'react';
import { Clock3, DatabaseBackup, GitBranch, History, LogOut, MapPin, Search, Sparkles, Users, FileText, Command, Moon, Sun, MoreHorizontal } from 'lucide-react';
import type { Theme } from '../hooks/useTheme';
import type { SavePhase, Workspace } from '../types';
import { SaveStatus } from '../shared/ui/SaveStatus';
import { PRODUCT_NAME } from '../config/branding';
import { useLanguage } from '../language';
import { Menu, MenuItem } from '../shared/ui/Menu';
import { Popover } from '../shared/ui/Popover';

export function AppShell({ title, workspace, onWorkspace, phase, error, retry, theme, onTheme, onSearch, onCommands, onHistory, onGit, onBackups, onAssistant, whoami, onLogout, version, children }: {
  title: string; workspace: Workspace; onWorkspace: (value: Workspace) => void; phase: SavePhase; error?: string; retry: () => void; theme: Theme; onTheme: () => void;
  onSearch: () => void; onCommands: () => void; onHistory: () => void; onGit: () => void; onBackups: () => void; onAssistant: () => void;
  whoami?: { email?: string; name?: string } | null; onLogout?: () => void; version?: string; children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowButton = useRef<HTMLButtonElement>(null);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);
  const runOverflow = (action: () => void) => { setOverflowOpen(false); action(); };
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
        <button className="command-hint" onClick={onCommands} title={t('commandSearch')} aria-label={t('openCommands')}><Command /><kbd>⌘ K</kbd></button>
        <button ref={overflowButton} aria-haspopup="menu" aria-expanded={overflowOpen} onClick={() => setOverflowOpen(value => !value)} aria-label={t('menuMore')} title={t('menuMore')}><MoreHorizontal /></button>
      </div>
      <SaveStatus phase={phase} error={error} onRetry={retry} />
      <Popover anchorRef={overflowButton} open={overflowOpen} onClose={closeOverflow} label={t('menuActions')}><Menu label={t('menuActions')} onClose={closeOverflow}>
        <MenuItem onSelect={() => runOverflow(onHistory)}><History />{t('history')}</MenuItem>
        <MenuItem onSelect={() => runOverflow(onGit)}><GitBranch />Git</MenuItem>
        <MenuItem onSelect={() => runOverflow(onBackups)}><DatabaseBackup />{t('backups')}</MenuItem>
        <MenuItem onSelect={() => runOverflow(onTheme)}>{theme === 'dark' ? <Sun /> : <Moon />}{theme === 'dark' ? t('themeLightShort') : t('themeDarkShort')}</MenuItem>
        {whoami && onLogout && <MenuItem onSelect={() => runOverflow(onLogout)}><LogOut />{t('logout')}</MenuItem>}
      </Menu></Popover>
    </header>
    <main className="workspace">{children}</main>
  </div>;
}
