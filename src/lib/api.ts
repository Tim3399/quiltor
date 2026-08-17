import type { AssistantHistoryMessage, AssistantReply, FigureState, BackupStatus, Manuscript, WorldInfo, WritingIssue } from '../types';
import { languages, readInterfaceLanguage } from '../language';
import type { MessageKey } from '../language';

export type LanguageLookupMode = 'dictionary' | 'synonyms' | 'translation';
export type LanguageLookupResult = { lemma: string; partOfSpeech: string; meaning: string; values: string[]; source: string };
// `supported` is the edition's verdict, `available` this machine's. Supported
// but unavailable means "install Java, then press the button"; unsupported
// means the feature does not exist in this build at all — a store build may
// neither download LanguageTool's JAR nor launch the system JVM, so the UI
// hides the section rather than offering a button that cannot work. See
// backend/language/grammar/.
export type GrammarStatus = { supported: boolean; unsupportedReason: string; available: boolean; installed: boolean; running: boolean; version: string; javaVersion: number | null; javaRequired: number; externalConfigured: boolean; externalEnabled: boolean; download: { url: string; checksum: string; license: string } };
export type LanguageStatus = { ok: boolean; installed: boolean; stale: boolean; version: string | null; sources: Record<string, { version: string; url: string; checksum: string; license: string; attribution: string }>; grammar?: GrammarStatus };

// api.ts is a plain module used outside React's render cycle (event handlers, fetch
// callbacks), so it can't call the useLanguage() hook -- read the persisted preference
// directly instead, mirroring LanguageProvider's own default-language logic.
function currentLanguage() { return readInterfaceLanguage(); }

// Set once per tab when a world is opened (see App.tsx). Each browser tab has its
// own isolated JS module state, so this is safely per-tab even with multiple tabs
// open on different worlds — unlike a server-side "current world" pointer would be.
let activeWorldId = '';
export function setActiveWorld(id: string) { activeWorldId = id; }

function withWorldQuery(url: string): string {
  if (!activeWorldId) return url;
  return `${url}${url.includes('?') ? '&' : '?'}world=${encodeURIComponent(activeWorldId)}`;
}
function withWorldBody<T extends object>(data: T): T & { worldId?: string } {
  return activeWorldId ? { ...data, worldId: activeWorldId } : data;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.fehler || data?.grund || `HTTP ${response.status}`);
  return data as T;
}

const revisions = { manuscript: 0, figures: 0 };
async function loadDocument<T>(url: string, kind: keyof typeof revisions): Promise<T> {
  const response = await fetch(withWorldQuery(url), { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.fehler || `HTTP ${response.status}`);
  const tag = response.headers.get('ETag')?.replaceAll('"', '');
  if (tag && /^\d+$/.test(tag)) revisions[kind] = Number(tag);
  return data as T;
}
async function saveDocument<T extends object>(url: string, kind: keyof typeof revisions, data: T) {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': `"${revisions[kind]}"` }, body: JSON.stringify(withWorldBody(data)) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 409 ? languages[currentLanguage()].saveConflict : result?.fehler || `HTTP ${response.status}`);
  revisions[kind] = result.revision;
  return result as { ok: boolean; zeit: string; revision: number };
}

export const api = {
  version: () => json<{ ok: boolean; version: string }>('/api/version'),
  worlds: () => json<{ ok: boolean; worlds: WorldInfo[] }>('/api/worlds'),
  openWorld: (id: string) => json<{ ok: boolean; world: WorldInfo }>('/api/worlds/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }),
  createWorld: (title: string, backupUrl: string) => json<{ ok: boolean; world: WorldInfo }>('/api/worlds/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, backupUrl }) }),
  deleteWorld: (id: string) => json<{ ok: boolean }>('/api/worlds/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }),
  // multiUser is false when this instance has exactly one user; /logout does not
  // exist there, so the menu must not offer signing out of anything.
  whoami: () => json<{ ok: boolean; sub?: string; email?: string; name?: string; multiUser?: boolean }>('/api/whoami'),
  logout: () => fetch('/logout', { method: 'POST' }).then(() => undefined),
  figures: () => loadDocument<FigureState>('/api/state', 'figures'),
  manuscript: () => loadDocument<Manuscript>('/api/manuscript', 'manuscript'),
  saveFigures: (data: FigureState) => saveDocument('/api/state', 'figures', data),
  saveManuscript: (data: Manuscript) => saveDocument('/api/manuscript', 'manuscript', data),
  backupStatus: () => json<BackupStatus>(withWorldQuery('/api/backup')),
  saveSnapshot: (message: string, upload: boolean) => json<{ ok: boolean; grund?: string; log?: string[]; status?: BackupStatus }>('/api/backup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({ message, push: upload })),
  }),
  log: () => json<{ ok: boolean; commits: Array<{ hash: string; kurz: string; datum: string; betreff: string }> }>(withWorldQuery('/api/log')),
  diff: (ref = 'WORK', word = true, all = false) => json<{ ok: boolean; diff: string; neu: string[] }>(withWorldQuery(`/api/diff?ref=${encodeURIComponent(ref)}&modus=${word ? 'wort' : 'zeile'}&alles=${all ? 1 : 0}`)),
  textVersion: (ref: string, chapter: number, title: string) => json<{ ok: boolean; neu?: boolean; text: string }>(withWorldQuery(`/api/textfassung?ref=${encodeURIComponent(ref)}&kapitel=${chapter}&titel=${encodeURIComponent(title)}`)),
  backups: () => json<{ ok: boolean; backups: Array<{ name: string; created: string; size: number }> }>(withWorldQuery('/api/backups')),
  restore: (name: string) => json<{ ok: boolean }>('/api/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({ name })) }),
  assistantStatus: () => json<{ ok: boolean; available: boolean; mode: string; reason: string; installed: boolean; chunks: number; backend?: string; contextTokens?: number; model?: string }>(withWorldQuery('/api/assistant/status')),
  assistantInstall: () => json<{ ok: boolean; started: boolean }>('/api/assistant/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  assistantInstallStatus: () => json<{ ok: boolean; running: boolean; phase: string; percent: number; error: string }>('/api/assistant/install/status'),
  assistantChat: (question: string, history: AssistantHistoryMessage[] = [], signal?: AbortSignal, chapterIds?: string[], batch?: { runBatches: boolean; progressId: string }) =>
    json<AssistantReply>('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({ question, history, chapterIds, runBatches: batch?.runBatches, progressId: batch?.progressId, language: currentLanguage() })), signal }),
  assistantProgress: (id: string) => json<{ ok: boolean; progress: { total: number; done: number; labelKey?: MessageKey; labelParams?: Record<string, string | number>; startedAt: number; updatedAt: number } | null }>(`/api/assistant/progress?id=${encodeURIComponent(id)}`),
  languageStatus: () => json<LanguageStatus>('/api/language/status'),
  installLanguageData: () => json<{ ok: boolean; version: string; entries: number }>('/api/language/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  languageLookup: (language: 'de-DE' | 'en-GB', mode: LanguageLookupMode, query: string, signal?: AbortSignal) => json<{ ok: boolean; query: string; language: string; mode: string; version: string; results: LanguageLookupResult[] }>('/api/language/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, mode, query }), signal }),
  installGrammar: () => json<GrammarStatus & { ok: boolean }>('/api/language/grammar/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  checkGrammar: (text: string, customWords: string[], signal?: AbortSignal) => json<{ ok: boolean; language: 'de-DE'; issues: WritingIssue[] }>('/api/language/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'de-DE', text, customWords }), signal }),
  bookPdf: async () => {
    const response = await fetch('/api/book.pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({})) });
    if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.fehler || `HTTP ${response.status}`); }
    await saveBlob(`Quiltor-Buchfassung-${new Date().toISOString().slice(0, 10)}.pdf`, await response.blob());
  },
};

/** A real Error's own .message, never the "Error: " prefix String(error) adds to one. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Saving an export -------------------------------------------------------
// In a browser tab an `<a download>` is the only way to hand the user a file.
// In the desktop window it is the wrong way: a WebView only honours it with
// downloads switched on, and pywebview's own download handling puts up a modal
// save panel it can never answer -- on macOS that leaves an unclosable dialog
// and then kills the app (hosts/desktop/bridge/files.py explains the exact
// failure). So when the native bridge is there, Python gets the bytes and shows
// the save panel itself; the anchor stays for the browser.

type SaveVerdict = { ok?: boolean; cancelled?: boolean; error?: string; path?: string };
type DesktopFileBridge = { save_file: (name: string, content: string, encoding: string) => Promise<SaveVerdict> };

function desktopFiles(): DesktopFileBridge | null {
  const bridge = (window as { pywebview?: { api?: Partial<DesktopFileBridge> } }).pywebview?.api;
  return bridge && typeof bridge.save_file === 'function' ? bridge as DesktopFileBridge : null;
}

/** Bytes as base64, because the js_api bridge carries JSON, not binary. */
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // readAsDataURL gives "data:<type>;base64,<payload>" -- only the payload crosses the bridge.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error(languages[currentLanguage()].exportFailed));
    reader.readAsDataURL(blob);
  });
}

export async function saveBlob(name: string, blob: Blob): Promise<void> {
  const files = desktopFiles();
  if (files) {
    const verdict: SaveVerdict = await files.save_file(name, await base64(blob), 'base64').catch((error: unknown) => ({ error: errorMessage(error) }));
    // Cancelling the save panel is a decision, not a failure: stay quiet for it.
    if (verdict?.ok || verdict?.cancelled) return;
    throw new Error(verdict?.error || languages[currentLanguage()].exportFailed);
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function download(name: string, content: string, type = 'text/plain;charset=utf-8'): Promise<void> {
  return saveBlob(name, new Blob([content], { type }));
}
