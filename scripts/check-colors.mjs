import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const allowed = join(root, 'src/design/colors.css');
const extensions = new Set(['.css', '.html', '.ts', '.tsx']);
const ignored = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.git']);
const color = /#[\da-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|:\s*(?:white|black|transparent)(?=\s*[;}])/gi;
const violations = [];

function visit(path) {
  if (ignored.has(path.split(/[/\\]/).at(-1))) return;
  if (statSync(path).isDirectory()) return readdirSync(path).forEach(name => visit(join(path, name)));
  if (!extensions.has(extname(path)) || path === allowed) return;
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    const matches = line.match(color);
    if (matches) violations.push(`${relative(root, path)}:${index + 1}: ${matches.join(', ')}`);
  });
}

visit(root);
if (violations.length) {
  console.error('Farben dürfen ausschließlich in src/design/colors.css definiert werden:\n' + violations.join('\n'));
  process.exit(1);
}
