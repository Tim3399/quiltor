import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "packages", "client", "src");
const platformRoot = "packages/client/src/platform";
const testRoot = "packages/client/src/test";
const violations = [];
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

function visitProfile(path) {
  const relativePath = relative(root, path).replaceAll("\\", "/");
  if (statSync(path).isDirectory()) {
    if (relativePath === testRoot) return;
    for (const name of readdirSync(path)) visitProfile(join(path, name));
    return;
  }
  if (![".ts", ".tsx"].includes(extname(path)) || /\.test(Support)?\.tsx?$/.test(path)) return;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (profileNames.test(line)) {
        violations.push(
          `${relativePath}:${index + 1}: branch on a capability flag such as installable, not on the operation profile`,
        );
      }
    });
}

function visit(path) {
  const relativePath = relative(root, path).replaceAll("\\", "/");
  if (statSync(path).isDirectory()) {
    if (relativePath === platformRoot || relativePath === testRoot) return;
    for (const name of readdirSync(path)) visit(join(path, name));
    return;
  }
  if (![".ts", ".tsx"].includes(extname(path)) || /\.test\.tsx?$/.test(path)) return;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const [capability, pattern] of forbidden) {
        if (pattern.test(line)) {
          violations.push(
            `${relativePath}:${index + 1}: access ${capability} through PlatformGateway`,
          );
        }
      }
    });
}

visit(sourceRoot);
visitProfile(sourceRoot);

if (violations.length) {
  console.error(`Platform boundary violations (${violations.length}):\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    "Platform-dependent capabilities are isolated behind PlatformGateway; no client code names the operation profile.",
  );
}
