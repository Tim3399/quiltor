import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { FigureProfilePanel } from "./FigureProfilePanel";

afterEach(cleanup);

describe("FigureProfilePanel layout", () => {
  it("owns a wrapping copy region instead of squeezing it beside the add action", () => {
    const view = render(
      <I18nProvider>
        <FigureProfilePanel
          figure={{ id: "ada", x: 0, y: 0, name: "Ada", type: "person" }}
          onPatch={vi.fn()}
        />
      </I18nProvider>,
    );
    const copy = view.container.querySelector<HTMLElement>(".figure-profile-fields-copy");
    const heading = view.container.querySelector<HTMLElement>(".figure-profile-fields-heading");

    expect(copy).toBeInTheDocument();
    expect(heading).toContainElement(copy);

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/figures/FigureInspector.css"),
      "utf8",
    );
    const headingRule = css.match(/\.figure-profile-fields-heading\s*\{([^}]*)\}/s)?.[1];
    const copyRule = css.match(/\.figure-profile-fields-copy\s*\{([^}]*)\}/s)?.[1];
    const actionRule = css.match(/\.figure-profile-field-add\s*\{([^}]*)\}/s)?.[1];

    expect(headingRule).toContain("flex-wrap: wrap");
    expect(copyRule).toContain("min-width: min(100%, 160px)");
    expect(copyRule).toContain("flex: 1 1 160px");
    expect(actionRule).toContain("margin-inline-start: auto");
  });
});
