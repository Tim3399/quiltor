export const designIndexImports = Object.freeze([
  "./colors.css",
  "./tokens.css",
  "./materials.css",
  "./motion.css",
  "./base.css",
  "./typography.css",
]);

/** The public design entrypoint is an import manifest, never a rule owner. */
export function designIndexViolations(source) {
  const violations = [];
  const imports = [];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^@import\s+"([^"]+)";$/.exec(line);
    if (!match) {
      violations.push(`line ${index + 1} is not an authorized import-only declaration`);
      continue;
    }
    imports.push(match[1]);
  }
  if (imports.join("\0") !== designIndexImports.join("\0")) {
    violations.push("imports must exactly match the ordered design authority manifest");
  }
  return violations;
}
