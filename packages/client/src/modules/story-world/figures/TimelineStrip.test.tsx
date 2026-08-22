import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { TimelineStrip } from "./TimelineStrip";

afterEach(cleanup);

describe("TimelineStrip", () => {
  it("keeps its horizontal rail on the Quiltor scrollbar contract", () => {
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
    expect(container.querySelector(".timeline-track")).toBeInTheDocument();

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/figures/TimelineStrip.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.timeline-track\s*\{[^}]*scrollbar-color:\s*var\(--line-strong\)\s+var\(--transparent\);[^}]*scrollbar-width:\s*thin;[^}]*--scrollbar-surface:\s*var\(--panel\);/s,
    );
    expect(css).toMatch(
      /\.timeline-track::\-webkit-scrollbar\s*\{[^}]*height:\s*var\(--space-10\);/s,
    );
    expect(css).toMatch(
      /\.timeline-track::\-webkit-scrollbar-thumb\s*\{[^}]*border:\s*var\(--space-3\)\s+solid\s+var\(--scrollbar-surface\);[^}]*background:\s*var\(--line-strong\);/s,
    );
    expect(css).toContain(".timeline-track::-webkit-scrollbar-thumb:hover");
    expect(css).toContain(".timeline-track::-webkit-scrollbar-thumb:active");
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
