import { describe, expect, it } from "vitest";
import css from "../components/WorkspaceToolbar/WorkspaceToolbar.css?raw";

describe("workspace toolbar spacing contract", () => {
  it("scopes title growth to titles that are direct toolbar children", () => {
    const titleBlock = css.match(/\.workspace-toolbar__title\s*\{([^}]*)\}/s)?.[1];
    expect(titleBlock).toBeDefined();
    expect(titleBlock).not.toMatch(/(?:^|;)\s*flex:/);
    expect(css).toMatch(
      /\.workspace-toolbar > \.workspace-toolbar__title\s*\{[^}]*min-width:\s*160px;[^}]*flex:\s*1 1 160px;[^}]*margin-inline-end:\s*auto;/s,
    );
  });

  it("places every separator between equal logical group insets", () => {
    expect(css).toMatch(
      /\.workspace-toolbar__group,[^{]*\.workspace-toolbar__actions > fieldset,[^{]*\.workspace-toolbar > fieldset\s*\{[^}]*padding-inline:\s*var\(--spacing-transition-control-inline-compact\);[^}]*border-inline-start:\s*1px solid var\(--line\);/s,
    );
    expect(css).toMatch(/\.workspace-toolbar__actions\s*\{[^}]*gap:\s*0;/s);
    expect(css).toMatch(
      /@media \(max-width: 719px\)[\s\S]*\.workspace-toolbar__actions\s*\{[^}]*contain:\s*layout inline-size;/,
    );
    expect(css).toMatch(
      /\.workspace-toolbar__actions > \.workspace-toolbar__group:first-child,[^{]*\{[^}]*padding-inline-start:\s*0;[^}]*border-inline-start:\s*0;/s,
    );
    expect(css).toMatch(
      /\.workspace-toolbar__actions > \.workspace-toolbar__group:last-child,[^{]*\{[^}]*padding-inline-end:\s*0;/s,
    );
  });

  it("owns the outer insets of semantic composite fieldset groups", () => {
    expect(css).toMatch(
      /\.workspace-toolbar__actions > fieldset,[^{]*\.workspace-toolbar > fieldset\s*\{[^}]*padding-inline:\s*var\(--spacing-transition-control-inline-compact\);[^}]*border-inline-start:\s*1px solid var\(--line\);/s,
    );
  });
});
