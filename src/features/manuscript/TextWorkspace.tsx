import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FilePlus2, Focus, History as HistoryIcon, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Pilcrow, Printer, Redo2, Trash2, Undo2, X } from 'lucide-react';
import type { Chapter, FigureState, Manuscript } from '../../types';
import { uid, wordCount } from '../../types';
import { download } from '../../lib/api';
import { ConfirmDialog, DELETE_HOLD_MS } from '../../shared/ui/ConfirmDialog';
import { api } from '../../lib/api';
import type { CommitInfo } from '../../types';
import './TextWorkspace.css';
import { completeOneWord, writingVocabulary, type WordCompletion } from './autocomplete';
import { useLanguage } from '../../language';
import { Sheet } from '../../shared/ui/Sheet';
import type { ViewportMode } from '../../hooks/useWorkspaceLayout';

export function TextWorkspace({ worldTitle, manuscript, figures, onChange, focus, onFocus, targetId, onUndo, onRedo, canUndo = false, canRedo = false, onSave, viewportMode = window.innerWidth < 720 ? 'compact' : window.innerWidth < 1100 ? 'regular' : 'wide', binderOpen: controlledBinderOpen, onBinderOpen, inspectorOpen: controlledInspectorOpen, onInspectorOpen, sidebarWidth = 246, onSidebarWidth, inspectorWidth = 294, onInspectorWidth }: {
  worldTitle?: string; manuscript: Manuscript; figures: FigureState; onChange: (value: Manuscript) => void; focus: boolean; onFocus: (value: boolean) => void; targetId?: string; onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean; onSave?: () => Promise<void>; viewportMode?: ViewportMode; binderOpen?: boolean; onBinderOpen?: (open: boolean) => void; inspectorOpen?: boolean; onInspectorOpen?: (open: boolean) => void; sidebarWidth?: number; onSidebarWidth?: (width: number) => void; inspectorWidth?: number; onInspectorWidth?: (width: number) => void;
}) {
  const { t } = useLanguage();
  const [currentId, setCurrentId] = useState(manuscript.chapters[0]?.id ?? '');
  const [inspector, setInspector] = useState<'chapter' | 'helpers'>('chapter');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [localBinderOpen, setLocalBinderOpen] = useState(() => window.innerWidth >= 720);
  const [localInspectorOpen, setLocalInspectorOpen] = useState(() => window.innerWidth >= 1100);
  const binderOpen = controlledBinderOpen ?? localBinderOpen;
  const inspectorOpen = controlledInspectorOpen ?? localInspectorOpen;
  const setBinderOpen = onBinderOpen ?? setLocalBinderOpen;
  const setInspectorOpen = onInspectorOpen ?? setLocalInspectorOpen;
  const [newWord, setNewWord] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [symbolPicker, setSymbolPicker] = useState(false);
  const [focusHelpers, setFocusHelpers] = useState(false);
  const [focusChapters, setFocusChapters] = useState(false);
  const [completion, setCompletion] = useState<WordCompletion | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [historyRef, setHistoryRef] = useState('');
  const [historicalText, setHistoricalText] = useState('');
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'error'>('idle');
  const area = useRef<HTMLTextAreaElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const current = manuscript.chapters.find(chapter => chapter.id === currentId) ?? manuscript.chapters[0];
  const currentIndex = current ? manuscript.chapters.indexOf(current) + 1 : 0;
  useEffect(() => { if (targetId && manuscript.chapters.some(chapter => chapter.id === targetId)) setCurrentId(targetId); }, [targetId, manuscript.chapters]);
  useEffect(() => { if (!focus) setFocusHelpers(false); }, [focus]);
  useEffect(() => {
    if (!historyOpen || commits.length) return;
    setHistoryState('loading');
    void api.log().then(result => { setCommits(result.commits); setHistoryRef(result.commits[0]?.hash || ''); setHistoryState('idle'); }).catch(() => setHistoryState('error'));
  }, [historyOpen, commits.length]);
  useEffect(() => {
    if (!historyOpen || !historyRef || !current) return;
    setHistoryState('loading');
    // current.title has to stay a dependency (the lookup is by archived filename, which
    // is derived from the title), but that means every keystroke while editing the title
    // would otherwise re-fire this fetch -- debounce so only a paused title settles it.
    const timeout = setTimeout(() => {
      void api.textVersion(historyRef, currentIndex, current.title).then(result => { setHistoricalText(result.neu ? '' : result.text); setHistoryState('idle'); }).catch(() => setHistoryState('error'));
    }, 400);
    return () => clearTimeout(timeout);
  }, [historyOpen, historyRef, current?.id, current?.title, currentIndex]);
  const total = useMemo(() => manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0), [manuscript.chapters]);
  const vocabulary = useMemo(() => writingVocabulary(manuscript, figures), [manuscript.words, figures.nodes]);
  const refreshCompletion = (value: string, start: number | null, end: number | null) => setCompletion(start !== null && start === end ? completeOneWord(value, start, vocabulary) : null);
  const acceptCompletion = () => {
    if (!current || !completion) return;
    const body = `${current.body.slice(0, completion.start)}${completion.word}${current.body.slice(completion.end)}`;
    const caret = completion.start + completion.word.length;
    update({ body }); setCompletion(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(caret, caret); });
  };
  useEffect(() => setCompletion(null), [currentId]);

  const setChapters = (chapters: Chapter[]) => onChange({ ...manuscript, chapters });
  const update = (patch: Partial<Chapter>) => current && setChapters(manuscript.chapters.map(chapter => chapter.id === current.id ? { ...chapter, ...patch } : chapter));
  const add = () => {
    const chapter = { id: uid('c'), title: t('newChapterTitle').replace('{n}', String(manuscript.chapters.length + 1)), body: '', note: '' };
    setChapters([...manuscript.chapters, chapter]); setCurrentId(chapter.id);
  };
  const move = (delta: number) => {
    if (!current) return; const from = manuscript.chapters.indexOf(current), to = from + delta;
    if (to < 0 || to >= manuscript.chapters.length) return;
    const chapters = [...manuscript.chapters]; [chapters[from], chapters[to]] = [chapters[to], chapters[from]]; setChapters(chapters);
  };
  const remove = () => {
    if (!current) return;
    const index = manuscript.chapters.indexOf(current); const chapters = manuscript.chapters.filter(chapter => chapter.id !== current.id);
    setCurrentId(chapters[Math.min(index, chapters.length - 1)]?.id ?? ''); setChapters(chapters);
  };
  const insert = (text: string) => {
    if (!current || !area.current) return; const el = area.current, start = el.selectionStart, end = el.selectionEnd;
    update({ body: current.body.slice(0, start) + text + current.body.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + text.length; });
  };
  const exportAll = () => download(`Quiltor-Manuskript-${new Date().toISOString().slice(0, 10)}.md`, manuscript.chapters.map(c => `# ${c.title || t('untitled')}\n\n${c.body.trim()}\n`).join('\n'));
  const printBook = async () => { setPdfState('loading'); try { await onSave?.(); await api.bookPdf(); setPdfState('idle'); } catch { setPdfState('error'); } };
  const addWord = () => { const value = newWord.trim(); if (!value) return; const words = manuscript.words || []; if (!words.some(item => (typeof item === 'string' ? item : item.w).toLocaleLowerCase('de-DE') === value.toLocaleLowerCase('de-DE'))) onChange({ ...manuscript, words: [...words, { w: value, d: '' }] }); setNewWord(''); };
  const beginResize = (side: 'sidebar' | 'inspector', event: React.PointerEvent) => {
    if (!layout.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = layout.current.getBoundingClientRect();
    const move = (next: PointerEvent) => side === 'sidebar' ? onSidebarWidth?.(next.clientX - bounds.left) : onInspectorWidth?.(bounds.right - next.clientX);
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };

  const binderPanel = <>
    <div className="panel-heading"><span>{t('chapters')}</span><button className="icon-button" onClick={() => setBinderOpen(false)} aria-label={t('closeNavigation')}><PanelLeftClose /></button></div>
    <div className="chapter-list">
      {manuscript.chapters.map((chapter, index) => <button key={chapter.id} draggable className={chapter.id === current?.id ? 'active' : ''} onClick={() => { setCurrentId(chapter.id); if (viewportMode === 'compact') setBinderOpen(false); }} onDragStart={() => setDraggedId(chapter.id)} onDragOver={event => event.preventDefault()} onDrop={() => { if (!draggedId || draggedId === chapter.id) return; const next = [...manuscript.chapters], from = next.findIndex(item => item.id === draggedId), to = next.findIndex(item => item.id === chapter.id); const [item] = next.splice(from, 1); next.splice(to, 0, item); setChapters(next); setDraggedId(null); }}>
        <span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-name">{chapter.title || t('untitled')}</span><span className="chapter-words">{wordCount(chapter.body)} {t('words')}</span>
      </button>)}
    </div>
    <footer>{manuscript.chapters.length} {t('chapters')} · {(total / 250).toFixed(1).replace('.', ',')} {t('standardPages')}</footer>
  </>;
  const inspectorPanel = current ? <>
    <div className="panel-heading"><span>{t('inspector')}</span><button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label={t('closeInspector')}><PanelRightClose /></button></div>
    <div className="panel-tabs" role="tablist">
      <button role="tab" aria-selected={inspector === 'chapter'} onClick={() => setInspector('chapter')}>{t('chapter')}</button>
      <button role="tab" aria-selected={inspector === 'helpers'} onClick={() => setInspector('helpers')}>{t('writingHelpers')}</button>
    </div>
    {inspector === 'chapter' ? <div className="panel-body">
      <dl className="stats"><div><dt>{t('words')}</dt><dd>{wordCount(current.body)}</dd></div><div><dt>{t('characters')}</dt><dd>{current.body.length}</dd></div><div><dt>{t('standardPages')}</dt><dd>{(wordCount(current.body) / 250).toFixed(1).replace('.', ',')}</dd></div></dl>
      <label className="field"><span>{t('chapterNote')}</span><textarea value={current.note} onChange={event => update({ note: event.target.value })} placeholder={t('chapterNotePlaceholder')} /></label>
      <div className="stack-actions"><button onClick={() => move(-1)}><ChevronUp />{t('moveUp')}</button><button onClick={() => move(1)}><ChevronDown />{t('moveDown')}</button></div>
      <button className="secondary-action" onClick={() => download(`${current.title || t('chapter')}.md`, `# ${current.title}\n\n${current.body}\n`)}><Download />{t('chapterMarkdown')}</button>
      <button className="danger-text" onClick={() => setDeleteOpen(true)}><Trash2 />{t('deleteChapter')}</button>
    </div> : <div className="panel-body helper-panel">
      <h3>{t('figuresPlaces')}</h3><div className="chip-list">{figures.nodes.map(node => <button key={node.id} onClick={() => insert(node.name)}>{node.name}</button>)}</div>
      <h3>{t('ownTerms')}</h3><div className="chip-list editable-chips">{(manuscript.words || []).map((item, index) => { const word = typeof item === 'string' ? item : item.w; return <span key={`${word}-${index}`}><button onClick={() => insert(word)}>{word}</button><button aria-label={t('removeTerm').replace('{word}', word)} onClick={() => onChange({ ...manuscript, words: (manuscript.words || []).filter((_, i) => i !== index) })}>×</button></span>; })}</div><div className="add-term"><input aria-label={t('newTerm')} value={newWord} onChange={event => setNewWord(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addWord(); }} placeholder={t('addTerm')} /><button onClick={addWord} aria-label={t('addTerm')}>+</button></div>
      <h3>{t('specialCharacters')}</h3><div className="chip-list symbols">{(manuscript.zeichenAktiv || ['„','“','–','—','…']).map(symbol => <button key={symbol} onClick={() => insert(symbol)}>{symbol}</button>)}<button aria-expanded={symbolPicker} onClick={() => setSymbolPicker(!symbolPicker)}>±</button></div>{symbolPicker && <div className="symbol-picker">{['„','“','‚','‘','»','«','›','‹','–','—','…','·','§','¶','†','°','′','″','×','±','½','¼'].map(symbol => { const active = (manuscript.zeichenAktiv || []).includes(symbol); return <button key={symbol} aria-pressed={active} onClick={() => onChange({ ...manuscript, zeichenAktiv: active ? (manuscript.zeichenAktiv || []).filter(item => item !== symbol) : [...(manuscript.zeichenAktiv || []), symbol] })}>{symbol}</button>; })}</div>}
    </div>}
  </> : null;

  return <section className={`text-workspace ${focus ? 'is-focus' : ''}`} aria-label={t('manuscript')}>
    <div className="context-bar">
      <div className="context-title"><strong>{current?.title || t('manuscript')}</strong><span>{total.toLocaleString('de-DE')} {t('totalWords')}</span></div>
      <div className="tool-group"><button className="primary" onClick={add}><FilePlus2 />{t('chapter')}</button></div>
      <div className="tool-group panel-toggles"><button aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><PanelRight />{t('details')}</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label={t('undoManuscript')}><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label={t('redoManuscript')}><Redo2 /></button></div>
      <div className="tool-group"><button aria-pressed={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><HistoryIcon />{t('versions')}</button></div>
      <div className="tool-group"><button aria-pressed={focus} onClick={() => onFocus(!focus)}><Focus />{t('focus')}</button></div>
      <div className="tool-group"><button onClick={exportAll}><Download />{t('manuscript')}</button><button disabled={pdfState === 'loading'} onClick={() => void printBook()} title={t('downloadBookPdfHelp')}><Printer />{pdfState === 'loading' ? t('creatingPdf') : t('bookPdf')}</button></div>
    </div>
    <div ref={layout} className={`text-layout ${!binderOpen || focus ? 'no-binder' : ''} ${!inspectorOpen || focus ? 'no-inspector' : ''}`} style={{ '--workspace-sidebar-width': `${sidebarWidth}px`, '--workspace-inspector-width': `${inspectorWidth}px` } as React.CSSProperties}>
      {!focus && viewportMode !== 'compact' && binderOpen && <aside className="binder drawer-open" aria-label={t('chapters')} style={{ width: sidebarWidth }}>{binderPanel}{onSidebarWidth && <div className="panel-resize-handle panel-resize-handle--end" role="separator" aria-orientation="vertical" aria-label={t('resizeNavigation')} tabIndex={0} onPointerDown={event => beginResize('sidebar', event)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 10 : -10)); }} />}</aside>}
      <article className="editor-scroll">
        {current ? <div className={`editor-page ${historyOpen ? 'has-chapter-history' : ''}`}>
          <div className="editor-document"><input className="chapter-title" aria-label={t('chapterTitle')} value={current.title} onChange={event => update({ title: event.target.value })} placeholder={t('chapterTitle')} />
          <textarea ref={area} className="prose-editor" aria-label={t('chapterText')} value={current.body} onChange={event => { update({ body: event.target.value }); refreshCompletion(event.target.value, event.target.selectionStart, event.target.selectionEnd); }} onClick={event => refreshCompletion(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)} onKeyUp={event => { if (event.key !== 'Tab') refreshCompletion(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd); }} onKeyDown={event => { if (event.key === 'Tab' && completion && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); acceptCompletion(); } }} placeholder={t('startWritingPlaceholder')} spellCheck />
          {completion && <div className="word-completion" role="status" aria-live="polite"><kbd>Tab</kbd><span>{completion.word}</span></div>}</div>
          {historyOpen && <aside className="chapter-history" aria-label={t('versions')}><header><div><strong>{t('previousVersion')}</strong><span>{t('nextToCurrent')}</span></div><button className="icon-button" onClick={() => setHistoryOpen(false)} aria-label={t('closeVersions')}><X /></button></header>
            {commits.length ? <label className="field"><span>{t('state')}</span><select value={historyRef} onChange={event => setHistoryRef(event.target.value)}>{commits.map(commit => <option key={commit.hash} value={commit.hash}>{commit.datum} · {commit.betreff}</option>)}</select></label> : historyState !== 'loading' && <p className="muted">{t('noVersion')}</p>}
            {historyState === 'loading' ? <p className="muted">{t('loadingVersion')}</p> : historyState === 'error' ? <div className="error-box">{t('versionLoadError')}</div> : commits.length > 0 && <div className="historical-prose">{historicalText || <em>{t('chapterNotYetExisting')}</em>}</div>}
          </aside>}
        </div> : <div className="empty-state"><FileTextIcon /><h2>{t('noChapterYet')}</h2><button className="primary" onClick={add}>{t('createFirstChapter')}</button></div>}
      </article>
      {!focus && viewportMode !== 'compact' && inspectorOpen && inspectorPanel && <aside className="inspector drawer-open" aria-label={t('chapterInspectorLabel')} style={{ width: inspectorWidth }}>{onInspectorWidth && <div className="panel-resize-handle panel-resize-handle--start" role="separator" aria-orientation="vertical" aria-label={t('resizeInspector')} tabIndex={0} onPointerDown={event => beginResize('inspector', event)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onInspectorWidth(inspectorWidth + (event.key === 'ArrowLeft' ? 10 : -10)); }} />}{inspectorPanel}</aside>}
    </div>
    {!focus && viewportMode === 'compact' && <Sheet open={binderOpen} label={t('chapters')} onClose={() => setBinderOpen(false)}><div className="binder compact-panel">{binderPanel}</div></Sheet>}
    {!focus && viewportMode === 'compact' && inspectorPanel && <Sheet open={inspectorOpen} label={t('chapterInspectorLabel')} onClose={() => setInspectorOpen(false)}><div className="inspector compact-panel">{inspectorPanel}</div></Sheet>}
    {focus && manuscript.chapters.length > 1 && <aside className={`focus-chapters ${focusChapters ? 'is-open' : ''}`} aria-label={t('focusChapterPickerLabel')}>
      <button className="focus-side-toggle" aria-expanded={focusChapters} onClick={() => setFocusChapters(!focusChapters)} title={t('selectChapters')}>
        {focusChapters ? <X /> : <PanelLeft />}<span className="sr-only">{focusChapters ? t('closeChapterPicker') : t('openChapterPicker')}</span>
      </button>
      {focusChapters && <nav className="focus-chapter-list">{manuscript.chapters.map((chapter, index) => <button key={chapter.id} className={chapter.id === current?.id ? 'active' : ''} aria-current={chapter.id === current?.id ? 'page' : undefined} onClick={() => { setCurrentId(chapter.id); requestAnimationFrame(() => area.current?.focus()); }}><span>{String(index + 1).padStart(2, '0')}</span><strong>{chapter.title || t('untitled')}</strong><small>{wordCount(chapter.body)} {t('words')}</small></button>)}</nav>}
    </aside>}
    {focus && <aside className={`focus-helper ${focusHelpers ? 'is-open' : ''}`} aria-label={t('focusHelperPanelLabel')}>
      <button className="focus-helper-toggle" aria-expanded={focusHelpers} onClick={() => setFocusHelpers(!focusHelpers)} title={t('focusHelper')}>
        {focusHelpers ? <X /> : <Pilcrow />}<span className="sr-only">{focusHelpers ? t('closeFocusHelper') : t('openFocusHelper')}</span>
      </button>
      {focusHelpers && <div className="focus-helper-panel">
        <section><h3>{t('figuresPlaces')}</h3><div className="focus-helper-chips">{figures.nodes.map(node => <button key={node.id} onClick={() => insert(node.name)}>{node.name}</button>)}</div></section>
        {!!(manuscript.words || []).length && <section><h3>{t('ownTerms')}</h3><div className="focus-helper-chips">{(manuscript.words || []).map((item, index) => { const word = typeof item === 'string' ? item : item.w; return <button key={`${word}-${index}`} onClick={() => insert(word)}>{word}</button>; })}</div></section>}
        <section><h3>{t('specialCharacters')}</h3><div className="focus-helper-chips focus-helper-symbols">{(manuscript.zeichenAktiv || ['„','“','–','—','…']).map(symbol => <button key={symbol} onClick={() => insert(symbol)}>{symbol}</button>)}</div></section>
      </div>}
    </aside>}
    {focus && <button className="exit-focus" onClick={() => onFocus(false)}>{t('leaveFocus')} <kbd>Esc</kbd></button>}
    <article className="print-document" aria-hidden="true" lang="de">
      <section className="book-title-page"><div><span>{t('novelLabel')}</span><h1>{worldTitle || t('untitledWorld')}</h1><i aria-hidden="true">◆</i></div><footer>{t('manuscriptVersionLabel')} {new Date().toLocaleDateString('de-DE')}</footer></section>
      {manuscript.chapters.map((chapter, chapterIndex) => <section className="book-chapter" key={chapter.id}><header><span>{String(chapterIndex + 1).padStart(2, '0')}</span><h2>{chapter.title || t('untitled')}</h2></header>{chapter.body.trim().split(/\n{2,}/).filter(Boolean).map((paragraph, index) => /^\s*([*⁂◆]|\*\s*\*\s*\*)\s*$/.test(paragraph) ? <div className="scene-break" key={index}>⁂</div> : <p key={index}>{paragraph.replace(/\n/g, ' ')}</p>)}</section>)}
    </article>
    {deleteOpen && current && <ConfirmDialog title={t('deleteChapter')} description={t('deleteChapterDescription').replace('{title}', current.title || t('untitled'))} confirmLabel={t('deleteChapter')} holdDurationMs={DELETE_HOLD_MS} onConfirm={remove} onClose={() => setDeleteOpen(false)} />}
    {pdfState === 'error' && <div className="toast error-box" role="alert">{t('bookPdfError')}<button onClick={() => setPdfState('idle')}><X /><span className="sr-only">{t('closeMessage')}</span></button></div>}
  </section>;
}

function FileTextIcon() { return <span className="empty-glyph" aria-hidden="true">Aa</span>; }
