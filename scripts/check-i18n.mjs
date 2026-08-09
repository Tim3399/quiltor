import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const excludedFiles = new Set([join(root, 'src', 'language')]);
const ignored = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.git']);

// Same escape hatch classNames the runtime MutationObserver in src/language/index.tsx uses
// for content that's intentionally never translated (user-authored prose, proper nouns).
const blocked = ['chapter-title', 'prose-editor', 'chapter-name', 'historical-prose', 'story-node', 'data-no-i18n'];

// Heuristic, not a real JSX parser: flags German-looking text (umlauts/ß, or a common
// German function word) inside aria-label/title/placeholder attribute values or JSX text
// content. It will under-report (misses German text built from ternaries/template
// literals split across `{}` expressions) and can false-positive (e.g. a user-typed
// example name that happens to contain "und"). Treat this as a first pass to skim, not
// a complete gate -- that's also why it isn't wired into `npm run build`.
const germanish = /[äöüßÄÖÜ]|\b(?:der|die|das|und|nicht|öffnen|schließen|löschen|neue?|keine?)\b/i;
const attr = /\b(?:aria-label|title|placeholder)=["']([^"'{}]*)["']/g;
const jsxText = />([^<>{}\n]{2,})</g;

const violations = [];

function isBlockedLine(line) {
  return blocked.some(name => line.includes(name));
}

function scan(file, text) {
  text.split('\n').forEach((line, index) => {
    if (isBlockedLine(line)) return;
    let m;
    attr.lastIndex = 0;
    while ((m = attr.exec(line))) if (germanish.test(m[1])) violations.push(`${file}:${index + 1}: [attr] "${m[1]}"`);
    jsxText.lastIndex = 0;
    while ((m = jsxText.exec(line))) {
      const content = m[1].trim();
      if (content && germanish.test(content)) violations.push(`${file}:${index + 1}: [text] "${content}"`);
    }
  });
}

function visit(path) {
  if (excludedFiles.has(path)) return;
  if (ignored.has(path.split(/[/\\]/).at(-1))) return;
  if (statSync(path).isDirectory()) return readdirSync(path).forEach(name => visit(join(path, name)));
  if (extname(path) !== '.tsx') return;
  scan(relative(root, path), readFileSync(path, 'utf8'));
}

visit(join(root, 'src'));
if (violations.length) {
  console.log(`Mögliche hartcodierte deutsche Texte außerhalb von t()-Aufrufen (${violations.length}):\n` + violations.join('\n'));
  console.log('\nDies ist ein heuristischer, unvollständiger Check (kein echter JSX-Parser) -- manuell prüfen, nicht blind vertrauen.');
} else {
  console.log('Keine offensichtlichen hartcodierten deutschen Texte gefunden.');
}
