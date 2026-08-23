import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace toolbar spacing contract", () => {
  it("places every separator between equal logical group insets", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/design/components/workspace.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.tool-group\s*\{[^}]*padding-inline:\s*var\(--space-9\);[^}]*border-inline-start:\s*1px solid var\(--line\);/s,
    );
    expect(css).toMatch(/\.context-tools\s*\{[^}]*gap:\s*0;/s);
    expect(css).toMatch(
      /\.context-tools > :first-child,[^{]*\{[^}]*padding-inline-start:\s*0;[^}]*border-inline-start:\s*0;/s,
    );
    expect(css).toMatch(/\.context-tools > :last-child,[^{]*\{[^}]*padding-inline-end:\s*0;/s);
  });
});
