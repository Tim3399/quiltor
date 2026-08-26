import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function styles(path: string) {
  return readFileSync(join(process.cwd(), "packages/client/src/design", path), "utf8");
}

function rule(source: string, selector: string) {
  const body = source.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "s"))?.[1];
  if (!body) throw new Error(`${selector} is missing`);
  return body;
}

describe.each([
  ["Alert", "components/Alert/Alert.css", "design-alert"],
  ["Toast", "components/Toast/Toast.css", "design-toast"],
] as const)("%s semantic feedback colors", (_name, path, owner) => {
  const source = styles(path);

  it.each([
    ["info", "--info-bg", "--info-border", "--info-text"],
    ["success", "--success-bg", "--success-border", "--success-text"],
    ["warning", "--warning-bg", "--warning-border", "--warning-text"],
    ["danger", "--error-bg", "--error-border", "--error-text"],
  ])("maps %s to its complete semantic role set", (tone, background, border, text) => {
    const declarations = rule(source, `${owner}--${tone}`);
    expect(declarations).toContain(`background: var(${background})`);
    expect(declarations).toContain(`border-color: var(${border})`);
    expect(declarations).toContain(`color: var(${text})`);
  });

  it("gives warning a dedicated copper accent edge", () => {
    const warning = rule(source, `${owner}--warning`);
    expect(warning).toContain("var(--warning-icon)");
    expect(warning).not.toMatch(/var\(--(?:gold|accent-primary)/);
  });
});
