import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceLayout } from './useWorkspaceLayout';

describe('workspace layout persistence', () => {
  beforeEach(() => { localStorage.clear(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 }); });
  afterEach(cleanup);

  it('stores panel state and clamped widths per world and workspace', () => {
    const { result } = renderHook(() => useWorkspaceLayout('world-1', 'text'));
    act(() => { result.current.setNavigationOpen(false); result.current.setSidebarWidth(999); result.current.setInspectorWidth(100); });
    expect(result.current.layout).toMatchObject({ navigationOpen: false, sidebarWidth: 340, inspectorWidth: 240 });
    expect(JSON.parse(localStorage.getItem('quiltor-layout:world-1:text') || '{}')).toMatchObject({ navigationOpen: false, sidebarWidth: 340, inspectorWidth: 240 });
  });

  it('allows at most one panel in regular layouts', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    const { result } = renderHook(() => useWorkspaceLayout('world-1', 'text'));
    act(() => result.current.setInspectorOpen(true));
    expect(result.current.layout).toMatchObject({ navigationOpen: false, inspectorOpen: true });
    act(() => result.current.setNavigationOpen(true));
    expect(result.current.layout).toMatchObject({ navigationOpen: true, inspectorOpen: false });
  });
});
