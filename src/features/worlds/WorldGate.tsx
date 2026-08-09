import { useState } from 'react';
import { BookOpen, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { WorldInfo } from '../../types';
import { useLanguage } from '../../language';
import { PRODUCT_MARK, PRODUCT_NAME } from '../../config/branding';
import type { ThemePreference } from '../../hooks/useTheme';
import { ConfirmDialog, DELETE_HOLD_MS } from '../../shared/ui/ConfirmDialog';
import { SegmentedControl } from '../../shared/ui/SegmentedControl';
import { Sheet } from '../../shared/ui/Sheet';

export function WorldGate({ worlds, onOpen, onCreate, onDelete, theme, onTheme, error }: { worlds: WorldInfo[]; onOpen: (id: string) => Promise<void>; onCreate: (title: string, gitUrl: string) => Promise<void>; onDelete: (id: string) => Promise<void>; theme: ThemePreference; onTheme: (theme: ThemePreference) => void; error?: string }) {
  const [title, setTitle] = useState(''), [gitUrl, setGitUrl] = useState(''), [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorldInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  return <main className="world-gate"><section><div className="gate-preferences"><SegmentedControl label={t('designChoice')} value={theme} onChange={onTheme} options={[{ value: 'system', label: t('systemDesign') }, { value: 'light', label: t('lightDesign') }, { value: 'dark', label: t('darkDesign') }]} /><SegmentedControl label={t('languageChoice')} value={language} onChange={setLanguage} options={[{ value: 'de', label: t('germanLanguage') }, { value: 'en', label: t('englishLanguage') }]} /></div><header><span className="world-mark" aria-hidden="true">{PRODUCT_MARK}</span><div><small>{PRODUCT_NAME} · {t('authorWorkshop')}</small><h1>{t('whichWorld')}</h1><p>{t('worldIntro')}</p></div></header>
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="world-list-panel"><header><h2>{t('existingWorlds')}</h2><button className="world-create" onClick={() => setCreateOpen(true)}><Plus />{t('newWorld')}</button></header><div className="world-list">{worlds.map(world => <div className="world-list-item" key={world.id}><button className="world-open" disabled={busy} onClick={() => void run(() => onOpen(world.id))}><BookOpen /><span><strong>{world.title}</strong><small>{t('lastChanged')} {new Date(world.updated).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')}</small></span><ChevronRight /></button><button className="world-delete" disabled={busy} aria-label={`${world.title} – ${t('deleteWorld')}`} title={t('deleteWorld')} onClick={() => setDeleteTarget(world)}><Trash2 /></button></div>)}{!worlds.length && <p className="muted">{t('noWorld')}</p>}</div></div>
    </section>{createOpen && <Sheet open label={t('newWorld')} onClose={() => setCreateOpen(false)}><form className="world-create-sheet" onSubmit={event => { event.preventDefault(); if (title.trim()) void run(async () => { await onCreate(title.trim(), gitUrl.trim()); setCreateOpen(false); }); }}><header><h2>{t('newWorld')}</h2></header><p>{t('newWorldIntro')}</p><label className="field"><span>{t('worldTitle')}</span><input autoFocus value={title} maxLength={100} onChange={event => setTitle(event.target.value)} placeholder={t('worldExample')} /></label><label className="field"><span>{t('gitRepository')}</span><input value={gitUrl} onChange={event => setGitUrl(event.target.value)} placeholder={t('gitExample')} /></label><p className="muted">{t('repositoryRecommended')}</p><button className="world-create" disabled={busy || !title.trim()}><Plus />{t('createWorld')}</button></form></Sheet>}{deleteTarget && <ConfirmDialog title={t('deleteWorldTitle')} description={t('deleteWorldDescription').replace('{title}', deleteTarget.title)} confirmLabel={t('deleteWorld')} holdDurationMs={DELETE_HOLD_MS} onConfirm={() => void run(() => onDelete(deleteTarget.id))} onClose={() => setDeleteTarget(null)} />}</main>;
}
