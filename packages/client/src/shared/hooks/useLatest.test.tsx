import { act, render } from "@testing-library/react";
import { type RefObject, useEffect, useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import { useLatest } from "./useLatest";

// T-17 P0: the shared latest-value ref. It assigns in an insertion effect, so it is never
// written during render, and every effect of the same commit -- a child's layout effect
// included -- already sees the new value.

function LayoutReader({ valueRef, seen }: { valueRef: RefObject<string>; seen: string[] }) {
  useLayoutEffect(() => {
    seen.push(valueRef.current);
  });
  return null;
}

function Holder({
  value,
  seen,
  passive,
  expose,
}: {
  value: string;
  seen: string[];
  passive: string[];
  expose: (ref: RefObject<string>) => void;
}) {
  const valueRef = useLatest(value);
  useEffect(() => {
    expose(valueRef);
    passive.push(valueRef.current);
  });
  return <LayoutReader valueRef={valueRef} seen={seen} />;
}

function setup(initial: string) {
  const seen: string[] = [];
  const passive: string[] = [];
  let ref: RefObject<string> | null = null;
  const expose = (next: RefObject<string>) => {
    ref = next;
  };
  const view = render(<Holder value={initial} seen={seen} passive={passive} expose={expose} />);
  const rerender = (value: string) =>
    view.rerender(<Holder value={value} seen={seen} passive={passive} expose={expose} />);
  const current = () => {
    if (!ref) throw new Error("the ref was not exposed");
    return ref;
  };
  return { seen, passive, rerender, current };
}

describe("useLatest", () => {
  it("returns one stable ref across renders", () => {
    const { rerender, current } = setup("a");
    const first = current();
    rerender("b");
    expect(current()).toBe(first);
  });

  it("lets a handler and a passive effect read the value of the latest render", () => {
    const { passive, rerender, current } = setup("a");
    rerender("b");
    // What a handler running now would read.
    expect(current().current).toBe("b");
    expect(passive.at(-1)).toBe("b");
  });

  it("is already current in a child's layout effect of the same commit", () => {
    const { seen, rerender } = setup("a");
    rerender("b");
    expect(seen).toEqual(["a", "b"]);
  });

  it("keeps a handler's write until the next commit, then the prop wins", () => {
    const { rerender, current } = setup("a");
    act(() => {
      // A handler passes `next` on and moves the ref ahead of the next render.
      current().current = "next";
    });
    expect(current().current).toBe("next");
    rerender("b");
    expect(current().current).toBe("b");
  });
});
