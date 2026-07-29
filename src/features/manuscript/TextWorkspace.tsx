import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FilePlus2, Focus, History as HistoryIcon, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Printer, Redo2, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type { Chapter, FigureState, Manuscript } from '../../types';
import { uid, wordCount } from '../../types';
import { download } from '../../lib/api';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { api } from '../../lib/api';
import type { CommitInfo } from '../../types';

export function TextWorkspace({ worldTitle, manuscript, figures, onChange, focus, onFocus, targetId, onUndo, onRedo, canUndo = false, canRedo = false, onSave }: {
  worldTitle?: string; manuscript: Manuscript; figures: FigureState; onChange: (value: Manuscript) => void; focus: boolean; onFocus: (value: boolean) => void; targetId?: string; onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean; onSave?: () => Promise<void>;
}) {
  const [currentId, setCurrentId] = useState(manuscript.chapters[0]?.id ?? '');
  const [inspector, setInspector] = useState<'chapter' | 'helpers'>('chapter');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [binderOpen, setBinderOpen] = useState(() => window.innerWidth > 820);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 820);
  const [newWord, setNewWord] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [symbolPicker, setSymbolPicker] = useState(false);
  const [focusHelpers, setFocusHelpers] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [historyRef, setHistoryRef] = useState('');
  const [historicalText, setHistoricalText] = useState('');
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'error'>('idle');
  const area = useRef<HTMLTextAreaElement>(null);
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
    void api.textVersion(historyRef, currentIndex, current.title).then(result => { setHistoricalText(result.neu ? '' : result.text); setHistoryState('idle'); }).catch(() => setHistoryState('error'));
  }, [historyOpen, historyRef, current?.id, current?.title, currentIndex]);
  const total = useMemo(() => manuscript.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0), [manuscript.chapters]);

  const setChapters = (chapters: Chapter[]) => onChange({ ...manuscript, chapters });
  const update = (patch: Partial<Chapter>) => current && setChapters(manuscript.chapters.map(chapter => chapter.id === current.id ? { ...chapter, ...patch } : chapter));
  const add = () => {
    const chapter = { id: uid('c'), title: `Kapitel ${manuscript.chapters.length + 1}`, body: '', note: '' };
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
  const exportAll = () => download(`Quiltor-Manuskript-${new Date().toISOString().slice(0, 10)}.md`, manuscript.chapters.map(c => `# ${c.title || 'Ohne Titel'}\n\n${c.body.trim()}\n`).join('\n'));
  const printBook = async () => { setPdfState('loading'); try { await onSave?.(); await api.bookPdf(); setPdfState('idle'); } catch { setPdfState('error'); } };
  const addWord = () => { const value = newWord.trim(); if (!value) return; const words = manuscript.words || []; if (!words.some(item => (typeof item === 'string' ? item : item.w).toLocaleLowerCase('de-DE') === value.toLocaleLowerCase('de-DE'))) onChange({ ...manuscript, words: [...words, { w: value, d: '' }] }); setNewWord(''); };

  return <section className={`text-workspace ${focus ? 'is-focus' : ''}`} aria-label="Manuskript">
    <div className="context-bar">
      <div className="context-title"><strong>{current?.title || 'Manuskript'}</strong><span>{total.toLocaleString('de-DE')} Wörter gesamt</span></div>
      <div className="tool-group"><button className="primary" onClick={add}><FilePlus2 />Kapitel</button></div>
      <div className="tool-group panel-toggles"><button aria-pressed={binderOpen} onClick={() => { setBinderOpen(!binderOpen); if (!binderOpen && window.innerWidth <= 820) setInspectorOpen(false); }}><PanelLeft />Navigation</button><button aria-pressed={inspectorOpen} onClick={() => { setInspectorOpen(!inspectorOpen); if (!inspectorOpen && window.innerWidth <= 820) setBinderOpen(false); }}><PanelRight />Details</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label="Manuskript rückgängig"><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label="Manuskript wiederholen"><Redo2 /></button></div>
      <div className="tool-group"><button aria-pressed={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><HistoryIcon />Versionen</button></div>
      <div className="tool-group"><button aria-pressed={focus} onClick={() => onFocus(!focus)}><Focus />Fokus</button></div>
      <div className="tool-group"><button onClick={exportAll}><Download />Manuskript</button><button disabled={pdfState === 'loading'} onClick={() => void printBook()} title="Gesetztes 6×9-Zoll-Buch herunterladen"><Printer />{pdfState === 'loading' ? 'Erzeuge PDF …' : 'Buch-PDF'}</button></div>
    </div>
    <div className={`text-layout ${!binderOpen || focus ? 'no-binder' : ''} ${!inspectorOpen || focus ? 'no-inspector' : ''}`}>
      {!focus && binderOpen && <aside className="binder drawer-open" aria-label="Kapitel">
        <div className="panel-heading"><span>Kapitel</span><button className="icon-button" onClick={() => setBinderOpen(false)} aria-label="Kapitelnavigation schließen"><PanelLeftClose /></button></div>
        <div className="chapter-list">
          {manuscript.chapters.map((chapter, index) => <button key={chapter.id} draggable className={chapter.id === current?.id ? 'active' : ''} onClick={() => setCurrentId(chapter.id)} onDragStart={() => setDraggedId(chapter.id)} onDragOver={event => event.preventDefault()} onDrop={() => { if (!draggedId || draggedId === chapter.id) return; const next = [...manuscript.chapters], from = next.findIndex(item => item.id === draggedId), to = next.findIndex(item => item.id === chapter.id); const [item] = next.splice(from, 1); next.splice(to, 0, item); setChapters(next); setDraggedId(null); }}>
            <span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-name">{chapter.title || 'Ohne Titel'}</span><span className="chapter-words">{wordCount(chapter.body)} Wörter</span>
          </button>)}
        </div>
        <footer>{manuscript.chapters.length} Kapitel · {(total / 250).toFixed(1).replace('.', ',')} Normseiten</footer>
      </aside>}
      <article className="editor-scroll">
        {current ? <div className={`editor-page ${historyOpen ? 'has-chapter-history' : ''}`}>
          <div className="editor-document"><input className="chapter-title" aria-label="Kapiteltitel" value={current.title} onChange={event => update({ title: event.target.value })} placeholder="Kapiteltitel" />
          <textarea ref={area} className="prose-editor" aria-label="Kapiteltext" value={current.body} onChange={event => update({ body: event.target.value })} placeholder="Schreib los …" spellCheck /></div>
          {historyOpen && <aside className="chapter-history" aria-label="Kapitelversionen"><header><div><strong>Frühere Fassung</strong><span>Direkt neben dem aktuellen Text</span></div><button className="icon-button" onClick={() => setHistoryOpen(false)} aria-label="Kapitelversionen schließen"><X /></button></header>
            {commits.length ? <label className="field"><span>Stand</span><select value={historyRef} onChange={event => setHistoryRef(event.target.value)}>{commits.map(commit => <option key={commit.hash} value={commit.hash}>{commit.datum} · {commit.betreff}</option>)}</select></label> : historyState !== 'loading' && <p className="muted">Noch keine gespeicherte Fassung vorhanden.</p>}
            {historyState === 'loading' ? <p className="muted">Fassung wird geladen …</p> : historyState === 'error' ? <div className="error-box">Die Fassung konnte nicht geladen werden.</div> : commits.length > 0 && <div className="historical-prose">{historicalText || <em>Dieses Kapitel existierte in diesem Stand noch nicht.</em>}</div>}
          </aside>}
        </div> : <div className="empty-state"><FileTextIcon /><h2>Noch kein Kapitel</h2><button className="primary" onClick={add}>Erstes Kapitel anlegen</button></div>}
      </article>
      {!focus && current && inspectorOpen && <aside className="inspector drawer-open" aria-label="Kapitel-Inspector">
        <div className="panel-heading"><span>Inspector</span><button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label="Inspector schließen"><PanelRightClose /></button></div>
        <div className="panel-tabs" role="tablist">
          <button role="tab" aria-selected={inspector === 'chapter'} onClick={() => setInspector('chapter')}>Kapitel</button>
          <button role="tab" aria-selected={inspector === 'helpers'} onClick={() => setInspector('helpers')}>Schreibhelfer</button>
        </div>
        {inspector === 'chapter' ? <div className="panel-body">
          <dl className="stats"><div><dt>Wörter</dt><dd>{wordCount(current.body)}</dd></div><div><dt>Zeichen</dt><dd>{current.body.length}</dd></div><div><dt>Normseiten</dt><dd>{(wordCount(current.body) / 250).toFixed(1).replace('.', ',')}</dd></div></dl>
          <label className="field"><span>Kapitelnotiz</span><textarea value={current.note} onChange={event => update({ note: event.target.value })} placeholder="Was muss in diesem Kapitel passieren?" /></label>
          <div className="stack-actions"><button onClick={() => move(-1)}><ChevronUp />Nach oben</button><button onClick={() => move(1)}><ChevronDown />Nach unten</button></div>
          <button className="secondary-action" onClick={() => download(`${current.title || 'Kapitel'}.md`, `# ${current.title}\n\n${current.body}\n`)}><Download />Kapitel als Markdown</button>
          <button className="danger-text" onClick={() => setDeleteOpen(true)}><Trash2 />Kapitel löschen</button>
        </div> : <div className="panel-body helper-panel">
          <h3>Figuren & Orte</h3><div className="chip-list">{figures.nodes.map(node => <button key={node.id} onClick={() => insert(node.name)}>{node.name}</button>)}</div>
          <h3>Eigene Begriffe</h3><div className="chip-list editable-chips">{(manuscript.words || []).map((item, index) => { const word = typeof item === 'string' ? item : item.w; return <span key={`${word}-${index}`}><button onClick={() => insert(word)}>{word}</button><button aria-label={`${word} entfernen`} onClick={() => onChange({ ...manuscript, words: (manuscript.words || []).filter((_, i) => i !== index) })}>×</button></span>; })}</div><div className="add-term"><input aria-label="Neuer Begriff" value={newWord} onChange={event => setNewWord(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addWord(); }} placeholder="Begriff hinzufügen" /><button onClick={addWord} aria-label="Begriff hinzufügen">+</button></div>
          <h3>Sonderzeichen</h3><div className="chip-list symbols">{(manuscript.zeichenAktiv || ['„','“','–','—','…']).map(symbol => <button key={symbol} onClick={() => insert(symbol)}>{symbol}</button>)}<button aria-expanded={symbolPicker} onClick={() => setSymbolPicker(!symbolPicker)}>±</button></div>{symbolPicker && <div className="symbol-picker">{['„','“','‚','‘','»','«','›','‹','–','—','…','·','§','¶','†','°','′','″','×','±','½','¼'].map(symbol => { const active = (manuscript.zeichenAktiv || []).includes(symbol); return <button key={symbol} aria-pressed={active} onClick={() => onChange({ ...manuscript, zeichenAktiv: active ? (manuscript.zeichenAktiv || []).filter(item => item !== symbol) : [...(manuscript.zeichenAktiv || []), symbol] })}>{symbol}</button>; })}</div>}
        </div>}
      </aside>}
    </div>
    {focus && <aside className={`focus-helper ${focusHelpers ? 'is-open' : ''}`} aria-label="Schreibhilfe im Fokusmodus">
      <button className="focus-helper-toggle" aria-expanded={focusHelpers} onClick={() => setFocusHelpers(!focusHelpers)} title="Schreibhilfe">
        {focusHelpers ? <X /> : <Sparkles />}<span className="sr-only">{focusHelpers ? 'Schreibhilfe schließen' : 'Schreibhilfe öffnen'}</span>
      </button>
      {focusHelpers && <div className="focus-helper-panel">
        <section><h3>Figuren & Orte</h3><div className="focus-helper-chips">{figures.nodes.map(node => <button key={node.id} onClick={() => insert(node.name)}>{node.name}</button>)}</div></section>
        {!!(manuscript.words || []).length && <section><h3>Eigene Begriffe</h3><div className="focus-helper-chips">{(manuscript.words || []).map((item, index) => { const word = typeof item === 'string' ? item : item.w; return <button key={`${word}-${index}`} onClick={() => insert(word)}>{word}</button>; })}</div></section>}
        <section><h3>Sonderzeichen</h3><div className="focus-helper-chips focus-helper-symbols">{(manuscript.zeichenAktiv || ['„','“','–','—','…']).map(symbol => <button key={symbol} onClick={() => insert(symbol)}>{symbol}</button>)}</div></section>
      </div>}
    </aside>}
    {focus && <button className="exit-focus" onClick={() => onFocus(false)}>Fokusmodus verlassen <kbd>Esc</kbd></button>}
    <article className="print-document" aria-hidden="true" lang="de">
      <section className="book-title-page"><div><span>Roman</span><h1>{worldTitle || 'Unbenannte Welt'}</h1><i aria-hidden="true">◆</i></div><footer>Manuskriptfassung · {new Date().toLocaleDateString('de-DE')}</footer></section>
      {manuscript.chapters.map((chapter, chapterIndex) => <section className="book-chapter" key={chapter.id}><header><span>{String(chapterIndex + 1).padStart(2, '0')}</span><h2>{chapter.title || 'Ohne Titel'}</h2></header>{chapter.body.trim().split(/\n{2,}/).filter(Boolean).map((paragraph, index) => /^\s*([*⁂◆]|\*\s*\*\s*\*)\s*$/.test(paragraph) ? <div className="scene-break" key={index}>⁂</div> : <p key={index}>{paragraph.replace(/\n/g, ' ')}</p>)}</section>)}
    </article>
    {deleteOpen && current && <ConfirmDialog title="Kapitel löschen" description={`„${current.title || 'Ohne Titel'}“ wird aus dem Manuskript entfernt. Halte den Löschknopf fünf Sekunden gedrückt.`} confirmLabel="Kapitel löschen" holdDurationMs={5000} onConfirm={remove} onClose={() => setDeleteOpen(false)} />}
    {pdfState === 'error' && <div className="toast error-box" role="alert">Das Buch-PDF konnte nicht erzeugt werden.<button onClick={() => setPdfState('idle')}><X /><span className="sr-only">Meldung schließen</span></button></div>}
  </section>;
}

function FileTextIcon() { return <span className="empty-glyph" aria-hidden="true">Aa</span>; }
