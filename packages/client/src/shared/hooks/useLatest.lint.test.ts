import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// T-17 P0: what keeps useLatest honest. react-hooks/refs recognises a ref by its `…Ref` name,
// so a value returned by useLatest stays checked only while it is named that way. The probe
// lints code under a path that does not exist (packages/client/src/__probe__), so the
// project's configuration applies to it and no fixture file makes `npm run lint:eslint` red.

// The suites run from the repository root, like the other unit tests that read files.
const root = process.cwd();
const sources = join(root, "packages/client/src");
const probePath = "packages/client/src/__probe__/useLatestProbe.tsx";

async function refsFindings(code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: join(root, probePath) });
  if (!result) throw new Error("ESLint returned no result for the probe");
  return result.messages
    .filter((message) => message.ruleId === "react-hooks/refs")
    .map((message) => `${message.line}: ${message.message}`);
}

const renderRead = `import { useLatest } from "../shared/hooks/useLatest";

export function Probe({ value }: { value: string }) {
  const valueRef = useLatest(value);
  return <span>{valueRef.current}</span>;
}
`;

const handlerWrite = `import { useLatest } from "../shared/hooks/useLatest";

export function Probe({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const valueRef = useLatest(value);
  const change = (next: string) => {
    onChange(next);
    valueRef.current = next;
  };
  return (
    <button type="button" onClick={() => change(valueRef.current + "!")}>
      {value}
    </button>
  );
}
`;

describe("useLatest lint contract", () => {
  it("reports a render read of a useLatest ref", async () => {
    expect(await refsFindings(renderRead)).not.toEqual([]);
  }, 60_000);

  it("lets a handler move the ref ahead of the next render", async () => {
    expect(await refsFindings(handlerWrite)).toEqual([]);
  }, 60_000);
});

// Every `= useLatest(` names its result `…Ref`, so the list of renamed refs cannot go stale.

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function unnamedLatestRefs(files: { path: string; source: string }[]): string[] {
  const offenders: string[] = [];
  for (const { path, source } of files) {
    source.split("\n").forEach((line, index) => {
      if (!line.includes("= useLatest(")) return;
      if (!/\b\w+Ref\s*(?::[^=]+)?=\s*useLatest\(/.test(line)) {
        offenders.push(`${path}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return offenders;
}

describe("useLatest naming guard", () => {
  it("finds every result of useLatest named …Ref", () => {
    // This file names the pattern it searches for, so it is left out.
    const files = sourceFiles(sources)
      .map((path) => ({
        path: relative(root, path).replaceAll("\\", "/"),
        source: readFileSync(path, "utf8"),
      }))
      .filter(({ path }) => path !== "packages/client/src/shared/hooks/useLatest.lint.test.ts");
    expect(files.some(({ source }) => source.includes("= useLatest("))).toBe(true);
    expect(unnamedLatestRefs(files)).toEqual([]);
  });

  it("reports a result without the Ref suffix", () => {
    const call = "= useLatest(";
    const files = [
      { path: "a.tsx", source: `const closeRef ${call}onClose);` },
      { path: "b.tsx", source: `  const latestState ${call}state);` },
    ];
    expect(unnamedLatestRefs(files)).toEqual([`b.tsx:1: const latestState ${call}state);`]);
  });
});
