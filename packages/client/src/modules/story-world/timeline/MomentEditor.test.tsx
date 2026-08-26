import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../../i18n";
import type { FigureState, TimelineMoment } from "../model";
import { MomentEditor, type MomentEditorProps } from "./MomentEditor";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";

afterEach(cleanup);

const moment: TimelineMoment = { id: "m1", title: "Ankunft" };
const state: FigureState = { nodes: [], edges: [], timeline: [moment] };

function Fixture({ onPatch }: { onPatch: MomentEditorProps["onPatch"] }) {
  const { locale, t } = useI18n();
  return (
    <MomentEditor
      state={state}
      timeline={[moment]}
      system={DEFAULT_TIME_SYSTEM}
      moment={moment}
      index={0}
      relativeAmount={1}
      relativeDirection="after"
      relativeBaseId=""
      chapterReferences={[]}
      rangeConflict={null}
      locale={locale}
      t={t}
      onSelectPrevious={vi.fn()}
      onSelectNext={vi.fn()}
      onMoveEarlier={vi.fn()}
      onMoveLater={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onPatch={onPatch}
      onStartChange={vi.fn()}
      onEndChange={vi.fn()}
      onClearEnd={vi.fn()}
      onRelativeChange={vi.fn()}
    />
  );
}

describe("MomentEditor", () => {
  it("owns selected-moment metadata patches", () => {
    const onPatch = vi.fn<MomentEditorProps["onPatch"]>();
    render(
      <I18nProvider>
        <Fixture onPatch={onPatch} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Abreise" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Notiz (optional)" }), {
      target: { value: "Nebel" },
    });
    expect(onPatch).toHaveBeenNthCalledWith(1, { title: "Abreise" });
    expect(onPatch).toHaveBeenNthCalledWith(2, { note: "Nebel" });
  });
});
