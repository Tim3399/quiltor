import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { TimelineStrip } from "./TimelineStrip";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});

describe("TimelineStrip", () => {
  it("delegates its horizontal rail to the public ScrollArea contract", () => {
    const { container } = render(
      <I18nProvider>
        <TimelineStrip
          timeline={[{ id: "arrival", title: "Ankunft" }]}
          activeId={null}
          playing={false}
          onPlay={vi.fn()}
          onSelect={vi.fn()}
          onAdd={vi.fn()}
          onPatch={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );
    const track = container.querySelector(".timeline-track");
    expect(track).toHaveClass("scroll-area", "timeline-track");
    expect(track).toHaveAttribute("data-axis", "x");
    expect(track).toHaveAttribute("data-gutter", "stable");
    expect(track).toHaveAttribute("data-scrollbar", "thin");
    expect(track).toHaveAttribute("data-surface", "panel");

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/figures/TimelineStrip.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.timeline-track\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*padding:\s*var\(--space-3\) var\(--space-4\);/s,
    );
    expect(css).not.toMatch(/\.timeline-track(?:\s*\{|::)[^}]*(?:overflow|scrollbar)/s);
    expect(css).not.toContain(".timeline-track::-webkit-scrollbar");
  });

  it("does not shrink compact timeline actions below the adaptive design size", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/figures/TimelineStrip.css"),
      "utf8",
    );
    const tokensCss = readFileSync(
      join(process.cwd(), "packages/client/src/design/tokens.css"),
      "utf8",
    );
    const headingActionRule = css.match(/\.timeline-heading-action\s*\{([^}]*)\}/s)?.[1];
    const playActionRule = css.match(/\.timeline-heading \.timeline-play\s*\{([^}]*)\}/s)?.[1];
    const momentActionRule = css.match(/\.timeline-moment-button\s*\{([^}]*)\}/s)?.[1];
    const addActionRule = css.match(/\.timeline-add-action\s*\{([^}]*)\}/s)?.[1];

    expect(headingActionRule).toBeDefined();
    expect(headingActionRule).not.toMatch(/\b(?:min-)?height\s*:/);
    expect(playActionRule).toBeDefined();
    expect(playActionRule).not.toMatch(/\b(?:min-|max-)?(?:width|height)\s*:/);
    expect(momentActionRule).toBeDefined();
    expect(momentActionRule).not.toMatch(/\b(?:min-)?height\s*:/);
    expect(addActionRule).toMatch(/flex:\s*0 0 auto;/);
    expect(addActionRule).toMatch(/align-self:\s*center;/);
    expect(addActionRule).toMatch(/justify-self:\s*end;/);
    expect(css).toMatch(
      /\.timeline-title,[\s\S]*?\.timeline-detail-input\s*\{[^}]*height:\s*var\(--control-compact\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.timeline-add\s*\{[^}]*grid-template-columns:[^;}]*var\(--control-compact\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.timeline-add\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--control-compact\);[^}]*gap:\s*var\(--space-4\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.timeline-title-field\s*\{[^}]*min-width:\s*0;[^}]*grid-column:\s*1 \/ -1;/,
    );
    expect(tokensCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?--control-compact:\s*var\(--control-touch\);/,
    );
  });

  it("owns timeline selection, playback, and moment creation controls", () => {
    const onPlay = vi.fn();
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    render(
      <I18nProvider>
        <TimelineStrip
          timeline={[{ id: "arrival", title: "Ankunft", date: "1420-03-12" }]}
          activeId={null}
          playing={false}
          onPlay={onPlay}
          onSelect={onSelect}
          onAdd={onAdd}
          onPatch={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zeitreise abspielen" }));
    fireEvent.click(screen.getByRole("button", { name: /Ankunft/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Neuer Zeitpunkt" }), {
      target: { value: "Verrat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zeitpunkt hinzufügen" }));

    expect(onPlay).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("arrival");
    expect(onAdd).toHaveBeenCalledWith("Verrat", undefined);
  });

  it("keeps the advancing playback moment centered without overriding reduced motion", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    let reducedMotion = false;
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    const timeline = [
      { id: "arrival", title: "Ankunft" },
      { id: "betrayal", title: "Verrat" },
      { id: "aftermath", title: "Danach" },
    ];
    const props = {
      timeline,
      onPlay: vi.fn(),
      onSelect: vi.fn(),
      onAdd: vi.fn(),
      onPatch: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(
      <I18nProvider>
        <TimelineStrip {...props} activeId="arrival" playing={false} />
      </I18nProvider>,
    );

    rerender(
      <I18nProvider>
        <TimelineStrip {...props} activeId="betrayal" playing={false} />
      </I18nProvider>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(
      <I18nProvider>
        <TimelineStrip {...props} activeId="betrayal" playing />
      </I18nProvider>,
    );

    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
    reducedMotion = true;
    rerender(
      <I18nProvider>
        <TimelineStrip {...props} activeId="aftermath" playing />
      </I18nProvider>,
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "auto",
      block: "nearest",
      inline: "center",
    });
  });
});
