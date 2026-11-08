import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { MeasureTarget } from "./placeCanvasModel";
import { PlaceScaleCalibration, useCalibrationGesture } from "./PlaceScaleCalibration";

afterEach(cleanup);

function form(props: Partial<Parameters<typeof PlaceScaleCalibration>[0]> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(
    <I18nProvider>
      <PlaceScaleCalibration
        ends={2}
        flowLength={150}
        defaultUnit="km"
        onApply={onApply}
        onCancel={onCancel}
        {...props}
      />
    </I18nProvider>,
  );
  return { onApply, onCancel };
}

describe("setting a scale from a measured stretch", () => {
  it("says where to start and where to end", () => {
    form({ ends: 0, flowLength: undefined });
    expect(screen.getByText("Maßstab messen: Setze den Anfang der Strecke.")).toBeVisible();
    cleanup();
    form({ ends: 1, flowLength: undefined });
    expect(screen.getByText("Setze das Ende der Strecke.")).toBeVisible();
  });

  it("previews the scale and applies it unrounded in the typed unit", () => {
    const { onApply } = form();
    const apply = screen.getByRole("button", { name: "Übernehmen" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Länge der Strecke" }), {
      target: { value: "100" },
    });
    expect(screen.getByText("ergibt 66.7 km pro 100px")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Einheit" }), {
      target: { value: "Meilen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(onApply).toHaveBeenCalledWith({ unitsPer100px: 200 / 3, unitLabel: "Meilen" });
  });

  it("refuses a stretch too short to read and a length that is not one", () => {
    form({ flowLength: 0.5 });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Länge der Strecke" }), {
      target: { value: "100" },
    });
    expect(screen.getByText("Die Strecke ist zu kurz.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeDisabled();
    cleanup();
    form();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Länge der Strecke" }), {
      target: { value: "0" },
    });
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeDisabled();
  });

  it("can be left without changing anything", () => {
    const { onApply, onCancel } = form();
    fireEvent.click(screen.getByRole("button", { name: "Maßstab messen beenden" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });
});

function Surface(props: {
  onStart: (start: MeasureTarget) => void;
  onPreview: (point: { x: number; y: number }) => void;
  onEnd: (end: MeasureTarget) => void;
  onClick: () => void;
}) {
  const gesture = useCalibrationGesture({
    active: true,
    toFlow: (client) => client,
    targetAt: (client) => ({ kind: "point", ...client }),
    onStart: props.onStart,
    onPreview: props.onPreview,
    onEnd: props.onEnd,
  });
  return (
    <div data-testid="surface" {...gesture}>
      <button type="button" onClick={props.onClick}>
        Fläche
      </button>
    </div>
  );
}

describe("drawing the stretch", () => {
  const press = (target: Element, pointerId: number, x: number, y: number) =>
    fireEvent.pointerDown(target, {
      pointerId,
      isPrimary: pointerId === 1,
      button: 0,
      clientX: x,
      clientY: y,
    });
  const move = (target: Element, pointerId: number, x: number, y: number) =>
    fireEvent.pointerMove(target, { pointerId, clientX: x, clientY: y });
  const release = (target: Element, pointerId: number, x: number, y: number) =>
    fireEvent.pointerUp(target, { pointerId, clientX: x, clientY: y });

  function setup() {
    const handlers = { onStart: vi.fn(), onPreview: vi.fn(), onEnd: vi.fn(), onClick: vi.fn() };
    render(<Surface {...handlers} />);
    return { ...handlers, target: screen.getByRole("button", { name: "Fläche" }) };
  }

  it("leaves a click alone: it reaches what was clicked", () => {
    const { onStart, onEnd, onClick, target } = setup();
    press(target, 1, 10, 10);
    move(target, 1, 12, 11);
    release(target, 1, 12, 11);
    fireEvent.click(target);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("turns a drag into both ends and swallows the click after it", () => {
    const { onStart, onPreview, onEnd, onClick, target } = setup();
    press(target, 1, 10, 10);
    move(target, 1, 60, 10);
    release(target, 1, 110, 10);
    fireEvent.click(target);
    expect(onStart).toHaveBeenCalledWith({ kind: "point", x: 10, y: 10 });
    expect(onPreview).toHaveBeenLastCalledWith({ x: 60, y: 10 });
    expect(onEnd).toHaveBeenCalledWith({ kind: "point", x: 110, y: 10 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("drops the stretch when a second finger joins: that is a pinch", () => {
    const { onEnd, target } = setup();
    press(target, 1, 10, 10);
    move(target, 1, 60, 10);
    press(target, 2, 200, 200);
    release(target, 1, 110, 10);
    release(target, 2, 220, 220);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
