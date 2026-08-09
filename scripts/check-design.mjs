import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const designRoot = join(root, 'src/design');
const extensions = new Set(['.css', '.html', '.ts', '.tsx']);
const ignored = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.git']);

const color = /#[\da-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|:\s*(?:white|black|transparent)(?=\s*[;}])/gi;

// Property-scoped, not value-scoped: unlike color literals (unambiguous syntax anywhere), raw
// px/em numbers are common outside the 5 tokenized categories, so each check requires the
// property name immediately before the number. This keeps width/top/border-width/grid-template-*
// (deliberately out of scope — structural/layout, not shared design decisions) from ever matching.
// 1px/-1px/-3px are exempt everywhere: hairline borders and optical-centering nudges, not spacing
// choices. 50%-based radii (circles) are exempt too — a legitimate escape hatch, not a scale value.
const hairline = new Set(['1px', '-1px', '-3px']);
const numberToken = /-?\d+(?:\.\d+)?(?:px|em)\b/g;

const propertyChecks = [
  ['Abstand', /\b(?:padding|margin)(?:-(?:top|bottom|left|right|inline|block))?\s*:\s*([^;{}]+)/gi, true],
  ['Abstand', /\b(?:gap|row-gap|column-gap)\s*:\s*([^;{}]+)/gi, true],
  ['Rundung', /\bborder-radius\s*:\s*([^;{}]+)/gi, false],
  ['Schatten', /\bbox-shadow\s*:\s*([^;{}]+)/gi, false],
  ['Schriftgröße', /\bfont(?:-size)?\s*:\s*([^;{}]+)/gi, false],
];
const zIndex = /\bz-index\s*:\s*(-?\d+)\b/gi;
const motion = /\b(?:animation(?:-duration)?|transition(?:-duration)?)\s*:\s*([^;{}]+)/gi;
const blur = /\b(?:backdrop-filter|filter)\s*:\s*([^;{}]*\bblur\([^;{}]+)/gi;

const violations = [];

function visit(path) {
  if (ignored.has(path.split(/[/\\]/).at(-1))) return;
  if (statSync(path).isDirectory()) return readdirSync(path).forEach(name => visit(join(path, name)));
  if (!extensions.has(extname(path))) return;
  const isDesignFile = path.startsWith(`${designRoot}/`);
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    if (isDesignFile) return;
    // print layout is a separate rendering context (pt/in units, relative em drop-cap sizing
    // tied to print typography) — not part of the app's screen-facing design token system.
    if (/^@media print\b|^@page\b/.test(line.trim())) return;
    const colorMatches = line.match(color);
    if (colorMatches) violations.push(`${relative(root, path)}:${index + 1}: [Farbe] ${colorMatches.join(', ')}`);

    for (const [label, re, exemptHairline] of propertyChecks) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const numbers = (m[1].match(numberToken) || []).filter(n => !(exemptHairline && hairline.has(n)));
        if (numbers.length) violations.push(`${relative(root, path)}:${index + 1}: [${label}] ${numbers.join(', ')}`);
      }
    }

    zIndex.lastIndex = 0;
    const zMatches = line.match(zIndex);
    if (zMatches) violations.push(`${relative(root, path)}:${index + 1}: [z-index] ${zMatches.join(', ')}`);
    motion.lastIndex = 0;
    let motionMatch;
    while ((motionMatch = motion.exec(line))) {
      const rawTimes = motionMatch[1].match(/\b\d+(?:\.\d+)?m?s\b/g) || [];
      if (rawTimes.length) violations.push(`${relative(root, path)}:${index + 1}: [Animation] ${rawTimes.join(', ')}`);
    }
    blur.lastIndex = 0;
    if (blur.test(line) && /blur\(\s*\d/.test(line)) violations.push(`${relative(root, path)}:${index + 1}: [Blur] roher Blur-Wert`);
  });
}

visit(root);
if (violations.length) {
  console.error('Farb- und Gestaltungswerte gehören ausschließlich in src/design/colors.css bzw. src/design/tokens.css:\n' + violations.join('\n'));
  process.exit(1);
}
