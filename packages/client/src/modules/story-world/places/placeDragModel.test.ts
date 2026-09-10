import { describe, expect, it } from "vitest";
import { cardPositionAtPointer, dragClientPoint, placeDropFrame } from "./placeDragModel";

describe("place drag pointer geometry", () => {
  it("uses the pointer as the centre for every measured card size", () => {
    expect(cardPositionAtPointer({ x: 480, y: 270 }, { width: 200, height: 96 })).toEqual({
      x: 380,
      y: 222,
    });
    expect(cardPositionAtPointer({ x: 480, y: 270 }, { width: 32, height: 32 })).toEqual({
      x: 464,
      y: 254,
    });
  });

  it("reads an active touch and the changed touch left by touchend", () => {
    const active = {
      touches: [{ clientX: 31, clientY: 47 }],
      changedTouches: [{ clientX: 90, clientY: 110 }],
    } as unknown as TouchEvent;
    const ended = {
      touches: [],
      changedTouches: [{ clientX: 90, clientY: 110 }],
    } as unknown as TouchEvent;

    expect(dragClientPoint(active)).toEqual({ x: 31, y: 47 });
    expect(dragClientPoint(ended)).toEqual({ x: 90, y: 110 });
  });

  it("drops a persistent pin on the exact pointer without a card footprint", () => {
    expect(
      placeDropFrame({
        pointer: { x: 523.5, y: 281.25 },
        position: { x: 400, y: 200 },
        size: { width: 312, height: 116 },
        anchored: true,
        pin: true,
      }),
    ).toEqual({ position: { x: 523.5, y: 281.25 } });
  });

  it("keeps the existing centred-card drop geometry", () => {
    expect(
      placeDropFrame({
        pointer: { x: 480, y: 270 },
        position: { x: 400, y: 200 },
        size: { width: 200, height: 96 },
        anchored: false,
        pin: false,
      }),
    ).toEqual({ position: { x: 380, y: 222 }, size: { width: 200, height: 96 } });
  });
});
