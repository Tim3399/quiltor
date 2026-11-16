import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const platformRoot = "packages/client/src/platform";
const testRoot = "packages/client/src/test";
const forbidden = [
  ["persistent storage", /\blocalStorage\b/],
  ["clipboard", /navigator\.clipboard/],
  ["external navigation", /window\.open/],
  ["desktop bridge", /\bpywebview\b/],
];

// The server's operation profile (D-59) stays on the server. The client branches on
// the flags it is given, such as `installable`, so a changed rule never needs a
// client release. Checked everywhere, the platform layer included.
const profileNames = /operation[_-]?profile|["'`](hosted|desktop)["'`]/i;

// `multiUser` is a fact on the wire, not something to branch on (T-102): the client
// asks for `signOut`, `deviceSync` or an install flag instead. It may appear where the
// wire is read and where the capabilities are derived from it.
const multiUser = /\bmultiUser\b/;
const multiUserAllowed = new Set([
  "packages/client/src/shared/capabilities.tsx",
  "packages/client/src/app/shell/useCapabilities.ts",
  // The account that keys a refused save's drafts belongs to a signed-in user of a
  // shared server, not to whether signing out is offered (T-102 F-102-3).
  "packages/client/src/app/shell/useShellStatus.ts",
]);

const isTest = (path) => /\.test(Support)?\.tsx?$/.test(path);

function sourceFiles(root, directory, skip) {
  const files = [];
  const walk = (path) => {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) {
      if (skip.includes(relativePath)) return;
      for (const name of readdirSync(path)) walk(join(path, name));
      return;
    }
    if ([".ts", ".tsx"].includes(extname(path))) files.push([path, relativePath]);
  };
  if (existsSync(directory)) walk(directory);
  return files;
}

function eachLine(path, visit) {
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      visit(line, index + 1);
    });
}

/** Every platform-boundary violation under `root`, as "path:line: message". */
export function checkPlatformBoundaries(root) {
  const sourceRoot = join(root, "packages", "client", "src");
  const violations = [];

  for (const [path, relativePath] of sourceFiles(root, sourceRoot, [platformRoot, testRoot])) {
    if (/\.test\.tsx?$/.test(path)) continue;
    eachLine(path, (line, number) => {
      for (const [capability, pattern] of forbidden) {
        if (pattern.test(line)) {
          violations.push(
            `${relativePath}:${number}: access ${capability} through PlatformGateway`,
          );
        }
      }
    });
  }

  for (const [path, relativePath] of sourceFiles(root, sourceRoot, [testRoot])) {
    if (isTest(path)) continue;
    const multiUserMayAppear =
      relativePath.startsWith(`${platformRoot}/`) || multiUserAllowed.has(relativePath);
    eachLine(path, (line, number) => {
      if (profileNames.test(line)) {
        violations.push(
          `${relativePath}:${number}: branch on a capability flag such as installable, not on the operation profile`,
        );
      }
      if (!multiUserMayAppear && multiUser.test(line)) {
        violations.push(
          `${relativePath}:${number}: branch on a capability flag, not on multiUser (T-102)`,
        );
      }
    });
  }

  return violations;
}
