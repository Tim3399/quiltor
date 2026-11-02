import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceLayout } from "./useWorkspaceLayout";

describe("workspace layout persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  });
  afterEach(cleanup);

  it("stores panel state and clamped widths per world and workspace", () => {
    const { result } = renderHook(() => useWorkspaceLayout("world-1", "text"));
    act(() => {
      result.current.setNavigationOpen(false);
      result.current.setSidebarWidth(999);
      result.current.setInspectorWidth(100);
    });
    expect(result.current.layout).toMatchObject({
      navigationOpen: false,
      sidebarWidth: 340,
      inspectorWidth: 240,
    });
    expect(JSON.parse(localStorage.getItem("quiltor-layout:world-1:text") || "{}")).toMatchObject({
      navigationOpen: false,
      sidebarWidth: 340,
      inspectorWidth: 240,
    });
  });

  it("renders the stored layout from the first render on, not the defaults (T-115)", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 820 });
    localStorage.setItem(
      "quiltor-layout:world-1:text",
      JSON.stringify({ navigationOpen: false, inspectorOpen: true }),
    );
    const rendered: boolean[] = [];
    renderHook(() => {
      const value = useWorkspaceLayout("world-1", "text");
      rendered.push(value.layout.navigationOpen);
      return value;
    });
    // A first paint with the default navigation reflows the text column before the stored
    // layout lands; the layout audit measured a word in that frame and missed it.
    expect(rendered).not.toContain(true);
  });

  it("reads the stored layout of the new key in the render that switches worlds", () => {
    localStorage.setItem(
      "quiltor-layout:world-2:text",
      JSON.stringify({ navigationOpen: false, sidebarWidth: 300 }),
    );
    const seen: { world: string; navigationOpen: boolean }[] = [];
    const { result, rerender } = renderHook(
      ({ world }) => {
        const value = useWorkspaceLayout(world, "text");
        seen.push({ world, navigationOpen: value.layout.navigationOpen });
        return value;
      },
      { initialProps: { world: "world-1" } },
    );
    expect(result.current.layout.navigationOpen).toBe(true);
    seen.length = 0;
    rerender({ world: "world-2" });
    expect(result.current.layout).toMatchObject({ navigationOpen: false, sidebarWidth: 300 });
    expect(seen.filter((entry) => entry.world === "world-2" && entry.navigationOpen)).toEqual([]);
  });

  it("allows at most one panel in regular layouts", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const { result } = renderHook(() => useWorkspaceLayout("world-1", "text"));
    act(() => result.current.setInspectorOpen(true));
    expect(result.current.layout).toMatchObject({ navigationOpen: false, inspectorOpen: true });
    act(() => result.current.setNavigationOpen(true));
    expect(result.current.layout).toMatchObject({ navigationOpen: true, inspectorOpen: false });
  });
});
