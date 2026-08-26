import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { TimelineStrip } from "./TimelineStrip";

afterEach(cleanup);

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
});
