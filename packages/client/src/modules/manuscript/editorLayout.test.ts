import { describe, expect, it } from "vitest";
import { editorBalanceOffset } from "./editorLayout";

describe("editorBalanceOffset", () => {
  it("balances each open panel around the workspace centre", () => {
    expect(editorBalanceOffset(1440, 246, 0)).toBe(-123);
    expect(editorBalanceOffset(1440, 0, 294)).toBe(147);
    expect(editorBalanceOffset(1440, 246, 294)).toBe(24);
  });

  it("keeps the normal grid when the page and panel gutters do not fit", () => {
    expect(editorBalanceOffset(1200, 0, 294)).toBeNull();
    expect(editorBalanceOffset(1411, 246, 294)).toBeNull();
    expect(editorBalanceOffset(1412, 246, 294)).toBe(24);
  });

  it("needs no correction for equally wide panels", () => {
    expect(editorBalanceOffset(1500, 294, 294)).toBe(0);
  });
});
