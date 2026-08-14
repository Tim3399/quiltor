// Manuscript/profile mirrors are always written as "{index:02d} - {title}.md"
// under manuscripts/ or profiles/ (see backend/mirror.py) -- this recovers a
// human title from a raw git path so authors never see file paths.
const MIRROR_TITLE_RE = /^\d{2,} - (.+)\.md$/;

export type PathKind = 'chapter' | 'profile' | 'database' | 'other';
export interface DescribedPath { kind: PathKind; title: string }

export function describePath(path: string): DescribedPath {
  const [directory, ...rest] = path.split('/');
  const name = rest.join('/');
  const match = MIRROR_TITLE_RE.exec(name);
  if (directory === 'manuscripts' && match) return { kind: 'chapter', title: match[1] };
  if (directory === 'profiles' && match) return { kind: 'profile', title: match[1] };
  if (path === 'world.sqlite3') return { kind: 'database', title: path };
  return { kind: 'other', title: path };
}

// Parses a `git status --porcelain` line ("XY path" or "R  old -> new") into the path.
export function porcelainPath(line: string): string {
  const path = line.slice(3).trim();
  const arrow = path.indexOf(' -> ');
  return arrow === -1 ? path : path.slice(arrow + 4);
}
