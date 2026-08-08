import type { AssistantReply, FigureState, GitStatus, Manuscript, WorldInfo } from '../types';

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
  if (!response.ok) throw new Error(response.status === 409 ? 'Speicherkonflikt: Die Seite wurde in einem anderen Tab geändert. Bitte neu laden.' : result?.fehler || `HTTP ${response.status}`);
  revisions[kind] = result.revision;
  return result as { ok: boolean; zeit: string; revision: number };
}

export const api = {
  version: () => json<{ ok: boolean; version: string }>('/api/version'),
  worlds: () => json<{ ok: boolean; worlds: WorldInfo[] }>('/api/worlds'),
  openWorld: (id: string) => json<{ ok: boolean; world: WorldInfo }>('/api/worlds/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }),
  createWorld: (title: string, gitUrl: string) => json<{ ok: boolean; world: WorldInfo }>('/api/worlds/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, gitUrl }) }),
  deleteWorld: (id: string) => json<{ ok: boolean }>('/api/worlds/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }),
  whoami: () => json<{ ok: boolean; sub?: string; email?: string; name?: string }>('/api/whoami'),
  logout: () => fetch('/logout', { method: 'POST' }).then(() => undefined),
  figures: () => loadDocument<FigureState>('/api/state', 'figures'),
  manuscript: () => loadDocument<Manuscript>('/api/manuscript', 'manuscript'),
  saveFigures: (data: FigureState) => saveDocument('/api/state', 'figures', data),
  saveManuscript: (data: Manuscript) => saveDocument('/api/manuscript', 'manuscript', data),
  gitStatus: () => json<GitStatus>(withWorldQuery('/api/git')),
  gitCommit: (message: string, push: boolean) => json<{ ok: boolean; grund?: string; log?: string[]; status?: GitStatus }>('/api/git', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({ message, push })),
  }),
  log: () => json<{ ok: boolean; commits: Array<{ hash: string; kurz: string; datum: string; betreff: string }> }>(withWorldQuery('/api/log')),
  diff: (ref = 'WORK', word = true, all = false) => json<{ ok: boolean; diff: string; neu: string[] }>(withWorldQuery(`/api/diff?ref=${encodeURIComponent(ref)}&modus=${word ? 'wort' : 'zeile'}&alles=${all ? 1 : 0}`)),
  textVersion: (ref: string, chapter: number, title: string) => json<{ ok: boolean; neu?: boolean; text: string }>(withWorldQuery(`/api/textfassung?ref=${encodeURIComponent(ref)}&kapitel=${chapter}&titel=${encodeURIComponent(title)}`)),
  backups: () => json<{ ok: boolean; backups: Array<{ name: string; created: string; size: number }> }>(withWorldQuery('/api/backups')),
  restore: (name: string) => json<{ ok: boolean }>('/api/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({ name })) }),
  assistantStatus: () => json<{ ok: boolean; available: boolean; mode: string; reason: string; chunks: number }>(withWorldQuery('/api/assistant/status')),
  assistantChat: (question: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = [], signal?: AbortSignal, chapterIds?: string[], batch?: { runBatches: boolean; progressId: string }) =>
    json<AssistantReply>('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({ question, history, chapterIds, runBatches: batch?.runBatches, progressId: batch?.progressId })), signal }),
  assistantProgress: (id: string) => json<{ ok: boolean; progress: { total: number; done: number; label: string; startedAt: number; updatedAt: number } | null }>(`/api/assistant/progress?id=${encodeURIComponent(id)}`),
  bookPdf: async () => {
    const response = await fetch('/api/book.pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withWorldBody({})) });
    if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.fehler || `HTTP ${response.status}`); }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `Quiltor-Buchfassung-${new Date().toISOString().slice(0, 10)}.pdf`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};

export function download(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
