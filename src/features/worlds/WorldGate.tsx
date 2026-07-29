import { useState } from 'react';
import { BookOpen, ChevronRight, Plus } from 'lucide-react';
import type { WorldInfo } from '../../types';
import { useLanguage } from '../../i18n/languages';
import { PRODUCT_MARK, PRODUCT_NAME } from '../../config/branding';

export function WorldGate({ worlds, onOpen, onCreate, error }: { worlds: WorldInfo[]; onOpen: (id: string) => Promise<void>; onCreate: (title: string, githubUrl: string) => Promise<void>; error?: string }) {
  const [title, setTitle] = useState(''), [githubUrl, setGithubUrl] = useState(''), [busy, setBusy] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  return <main className="world-gate"><section><div className="language-choice" role="group" aria-label="Language / Sprache"><button aria-pressed={language === 'de'} onClick={() => setLanguage('de')}>Deutsch</button><button aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button></div><header><span className="world-mark" aria-hidden="true">{PRODUCT_MARK}</span><div><small>{PRODUCT_NAME} · {t('authorWorkshop')}</small><h1>{t('whichWorld')}</h1><p>{t('worldIntro')}</p></div></header>
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="world-grid"><div><h2>{t('existingWorlds')}</h2><div className="world-list">{worlds.map(world => <button disabled={busy} key={world.id} onClick={() => void run(() => onOpen(world.id))}><BookOpen /><span><strong>{world.title}</strong><small>{t('lastChanged')} {new Date(world.updated).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')}</small></span><ChevronRight /></button>)}{!worlds.length && <p className="muted">{t('noWorld')}</p>}</div></div>
      <form onSubmit={event => { event.preventDefault(); if (title.trim() && githubUrl.trim()) void run(() => onCreate(title.trim(), githubUrl.trim())); }}><h2>{t('newWorld')}</h2><p>{t('newWorldIntro')}</p><label className="field"><span>{t('worldTitle')}</span><input autoFocus value={title} maxLength={100} onChange={event => setTitle(event.target.value)} placeholder={t('worldExample')} /></label><label className="field"><span>{t('githubRepository')}</span><input type="url" required value={githubUrl} onChange={event => setGithubUrl(event.target.value)} placeholder={t('githubExample')} /></label><p className="muted">{t('repositoryRequired')}</p><button className="world-create" disabled={busy || !title.trim() || !githubUrl.trim()}><Plus />{t('createWorld')}</button></form>
    </div></section></main>;
}
