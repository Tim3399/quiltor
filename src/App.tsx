import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AppShell } from './app/AppShell';
import { api, errorMessage, setActiveWorld } from './lib/api';
import { useAutosave } from './hooks/useAutosave';
import type { FigureState, Manuscript, Workspace, WorldInfo } from './types';
import { useHistoryState } from './hooks/useHistoryState';
import { useTheme } from './hooks/useTheme';
import { WorldGate } from './features/worlds/WorldGate';
import { PRODUCT_MARK } from './config/branding';
import { applyAssistantProposals } from './features/assistant/proposals';
import { useLanguage } from './language';

const TextWorkspace = lazy(() => import('./features/manuscript/TextWorkspace').then(module => ({ default: module.TextWorkspace })));
const FigureWorkspace = lazy(() => import('./features/figures/FigureWorkspace').then(module => ({ default: module.FigureWorkspace })));
const TimelineWorkspace = lazy(() => import('./features/timeline/TimelineWorkspace').then(module => ({ default: module.TimelineWorkspace })));
const PlacesWorkspace = lazy(() => import('./features/places/PlacesWorkspace').then(module => ({ default: module.PlacesWorkspace })));
const AssistantDrawer = lazy(() => import('./features/assistant/AssistantDrawer').then(module => ({ default: module.AssistantDrawer })));
const SearchDialog = lazy(() => import('./features/tools/SearchDialog').then(module => ({ default: module.SearchDialog })));
const GitDialog = lazy(() => import('./features/tools/GitDialog').then(module => ({ default: module.GitDialog })));
const HistoryDialog = lazy(() => import('./features/tools/HistoryDialog').then(module => ({ default: module.HistoryDialog })));
const BackupDialog = lazy(() => import('./features/tools/BackupDialog').then(module => ({ default: module.BackupDialog })));

type Overlay = 'search' | 'commands' | 'history' | 'git' | 'backups' | null;

export function App() {
  const { t } = useLanguage();
  const { theme, preference, setPreference, toggleTheme } = useTheme();
  const [workspace, setWorkspace] = useState<Workspace>('text');
  const manuscriptHistory = useHistoryState<Manuscript>(), figureHistory = useHistoryState<FigureState>();
  const manuscript = manuscriptHistory.value, figures = figureHistory.value;
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null), [world, setWorld] = useState<WorldInfo | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null), [focus, setFocus] = useState(false), [loadError, setLoadError] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [target, setTarget] = useState<{ workspace: Workspace; id: string } | null>(null);
  const [whoami, setWhoami] = useState<{ email?: string; name?: string } | null>(null);
  useEffect(() => { api.whoami().then(result => setWhoami(result.ok ? result : null)).catch(() => setWhoami(null)); }, []);
  const logout = useCallback(() => { void api.logout().then(() => { location.href = '/login'; }); }, []);
  const [version, setVersion] = useState('');
  useEffect(() => { api.version().then(result => setVersion(result.version)).catch(() => {}); }, []);
  const saveManuscript = useCallback((value: Manuscript) => api.saveManuscript(value), []);
  const saveFigures = useCallback((value: FigureState) => api.saveFigures(value), []);
  const manuscriptSave = useAutosave(manuscript, saveManuscript), figureSave = useAutosave(figures, saveFigures);
  const activeSave = workspace === 'text' ? manuscriptSave : figureSave;
  const flushAll = useCallback(async () => { await Promise.all([manuscriptSave.flush(), figureSave.flush()]); }, [manuscriptSave.flush, figureSave.flush]);
  const executeCommand = useCallback((command: string) => {
    setOverlay(null);
    if (command === 'text' || command === 'figures' || command === 'timeline' || command === 'places') { setWorkspace(command); setFocus(false); return; }
    if (command === 'focus') { setWorkspace('text'); setFocus(value => !value); return; }
    if (command === 'history' || command === 'git' || command === 'backups') setOverlay(command);
  }, []);

  const loadWorld = async (selected: Promise<{ ok: boolean; world: WorldInfo }>) => {
    setLoadError('');
    try { const result = await selected; setActiveWorld(result.world.id); const [m, f] = await Promise.all([api.manuscript(), api.figures()]); manuscriptHistory.load(m); figureHistory.load(f); setWorld(result.world); }
    catch (error) { setLoadError(errorMessage(error)); }
  };
  useEffect(() => { api.worlds().then(result => { setWorlds(result.worlds); const requested = new URLSearchParams(location.search).get('world'); if (requested) void loadWorld(api.openWorld(requested)); }).catch(error => { setWorlds([]); setLoadError(errorMessage(error)); }); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape' && focus) { event.preventDefault(); setFocus(false); return; }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 's') { event.preventDefault(); setOverlay('git'); return; }
      if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void flushAll(); return; }
      if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); setOverlay('search'); return; }
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setOverlay('commands'); }
      const inField = /input|textarea|select/i.test((event.target as HTMLElement)?.tagName || '');
      if (modifier && !inField && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? (workspace === 'text' ? manuscriptHistory.redo() : figureHistory.redo()) : (workspace === 'text' ? manuscriptHistory.undo() : figureHistory.undo()); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [focus, flushAll, workspace, manuscriptHistory.undo, manuscriptHistory.redo, figureHistory.undo, figureHistory.redo]);

  const [restartPrefix, restartSuffix] = t('restartServerHint').split('{code}');
  if (worlds === null) return <main className="loading-state"><div className="loading-mark">{PRODUCT_MARK}</div><p>{t('loadingWorlds')}</p></main>;
  if (!world) return <WorldGate worlds={worlds} theme={preference} onTheme={setPreference} error={loadError} onOpen={id => loadWorld(api.openWorld(id))} onCreate={(title, gitUrl) => loadWorld(api.createWorld(title, gitUrl))} onDelete={async id => { await api.deleteWorld(id); const result = await api.worlds(); setWorlds(result.worlds); }} />;
  if (loadError) return <main className="fatal-state"><h1>{t('unreachable')}</h1><p>{loadError}</p><p>{restartPrefix}<code>python3 server.py</code>{restartSuffix}</p></main>;
  if (!manuscript || !figures) return <main className="loading-state"><div className="loading-mark">{PRODUCT_MARK}</div><p>{t('openingWorkshop')}</p></main>;
  return <Suspense fallback={<main className="loading-state"><div className="loading-mark">{PRODUCT_MARK}</div><p>{t('openingWorkshop')}</p></main>}>
    <AppShell title={world.title} workspace={workspace} onWorkspace={value => { setWorkspace(value); setFocus(false); }} phase={activeSave.phase} error={activeSave.error} retry={activeSave.retry} theme={theme} onTheme={toggleTheme}
      onSearch={() => setOverlay('search')} onCommands={() => setOverlay('commands')} onHistory={() => setOverlay('history')} onGit={() => setOverlay('git')} onBackups={() => setOverlay('backups')} onAssistant={() => setAssistantOpen(value => !value)}
      whoami={whoami} onLogout={logout} version={version}>
      {workspace === 'text' ? <TextWorkspace worldTitle={world.title} manuscript={manuscript} figures={figures} onChange={manuscriptHistory.change} focus={focus} onFocus={setFocus} targetId={target?.workspace === 'text' ? target.id : undefined} onUndo={manuscriptHistory.undo} onRedo={manuscriptHistory.redo} canUndo={manuscriptHistory.canUndo} canRedo={manuscriptHistory.canRedo} onSave={flushAll} /> : workspace === 'figures' ? <FigureWorkspace state={figures} onChange={figureHistory.change} targetId={target?.workspace === 'figures' ? target.id : undefined} onUndo={figureHistory.undo} onRedo={figureHistory.redo} canUndo={figureHistory.canUndo} canRedo={figureHistory.canRedo} /> : workspace === 'timeline' ? <TimelineWorkspace state={figures} onChange={figureHistory.change} targetId={target?.workspace === 'timeline' ? target.id : undefined} onUndo={figureHistory.undo} onRedo={figureHistory.redo} canUndo={figureHistory.canUndo} canRedo={figureHistory.canRedo} /> : <PlacesWorkspace state={figures} onChange={figureHistory.change} targetId={target?.workspace === 'places' ? target.id : undefined} onUndo={figureHistory.undo} onRedo={figureHistory.redo} canUndo={figureHistory.canUndo} canRedo={figureHistory.canRedo} onOpen={selected => { setWorkspace(selected.workspace); setTarget(selected); }} />}
    </AppShell>
    {assistantOpen && <AssistantDrawer worldId={world.id} figures={figures} chapters={manuscript.chapters} onClose={() => setAssistantOpen(false)} onApply={proposals => { figureHistory.change(applyAssistantProposals(figures, proposals, t)); setWorkspace('figures'); setFocus(false); }} onNavigate={selected => { setWorkspace(selected.workspace); setTarget(selected); }} />}
    {(overlay === 'search' || overlay === 'commands') && <SearchDialog mode={overlay} manuscript={manuscript} figures={figures} onClose={() => setOverlay(null)} onWorkspace={setWorkspace} onSelect={setTarget} onCommand={executeCommand} />}
    {overlay === 'git' && <GitDialog onClose={() => setOverlay(null)} flush={flushAll} />}
    {overlay === 'history' && <HistoryDialog onClose={() => setOverlay(null)} flush={flushAll} />}
    {overlay === 'backups' && <BackupDialog onClose={() => setOverlay(null)} flush={flushAll} />}
  </Suspense>;
}
