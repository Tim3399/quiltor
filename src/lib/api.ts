import type { FigureState, GitStatus, Manuscript, WorldInfo } from '../types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.fehler || data?.grund || `HTTP ${response.status}`);
  return data as T;
}

const revisions = { manuscript: 0, figures: 0 };
async function loadDocument<T>(url: string, kind: keyof typeof revisions): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.fehler || `HTTP ${response.status}`);
  const tag = response.headers.get('ETag')?.replaceAll('"', '');
  if (tag && /^\d+$/.test(tag)) revisions[kind] = Number(tag);
  return data as T;
}
async function saveDocument<T>(url: string, kind: keyof typeof revisions, data: T) {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': `"${revisions[kind]}"` }, body: JSON.stringify(data) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 409 ? 'Speicherkonflikt: Die Seite wurde in einem anderen Tab geändert. Bitte neu laden.' : result?.fehler || `HTTP ${response.status}`);
  revisions[kind] = result.revision;
  return result as { ok: boolean; zeit: string; revision: number };
}

export const api = {
  worlds: () => json<{ ok: boolean; worlds: WorldInfo[] }>('/api/worlds'),
  openWorld: (id: string) => json<{ ok: boolean; world: WorldInfo }>('/api/worlds/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }),
  createWorld: (title: string, gitUrl: string) => json<{ ok: boolean; world: WorldInfo }>('/api/worlds/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, gitUrl }) }),
  figures: () => loadDocument<FigureState>('/api/state', 'figures'),
  manuscript: () => loadDocument<Manuscript>('/api/manuscript', 'manuscript'),
  saveFigures: (data: FigureState) => saveDocument('/api/state', 'figures', data),
  saveManuscript: (data: Manuscript) => saveDocument('/api/manuscript', 'manuscript', data),
  gitStatus: () => json<GitStatus>('/api/git'),
  gitCommit: (message: string, push: boolean) => json<{ ok: boolean; grund?: string; log?: string[]; status?: GitStatus }>('/api/git', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, push }),
  }),
  log: () => json<{ ok: boolean; commits: Array<{ hash: string; kurz: string; datum: string; betreff: string }> }>('/api/log'),
  diff: (ref = 'WORK', word = true, all = false) => json<{ ok: boolean; diff: string; neu: string[] }>(`/api/diff?ref=${encodeURIComponent(ref)}&modus=${word ? 'wort' : 'zeile'}&alles=${all ? 1 : 0}`),
  textVersion: (ref: string, chapter: number, title: string) => json<{ ok: boolean; neu?: boolean; text: string }>(`/api/textfassung?ref=${encodeURIComponent(ref)}&kapitel=${chapter}&titel=${encodeURIComponent(title)}`),
  backups: () => json<{ ok: boolean; backups: Array<{ name: string; created: string; size: number }> }>('/api/backups'),
  restore: (name: string) => json<{ ok: boolean }>('/api/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
  bookPdf: async () => {
    const response = await fetch('/api/book.pdf', { method: 'POST' });
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
