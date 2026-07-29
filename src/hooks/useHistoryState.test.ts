import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHistoryState } from './useHistoryState';

describe('useHistoryState', () => {
  it('macht gruppierte Änderungen rückgängig und wiederholt sie', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useHistoryState<{ text: string }>());
    act(() => result.current.load({ text: 'Anfang' }));
    act(() => result.current.change({ text: 'Erste Änderung' }));
    act(() => result.current.change({ text: 'Erste Änderung, weitergeschrieben' }));
    expect(result.current.value?.text).toBe('Erste Änderung, weitergeschrieben');
    act(() => result.current.undo());
    expect(result.current.value?.text).toBe('Anfang');
    act(() => result.current.redo());
    expect(result.current.value?.text).toBe('Erste Änderung, weitergeschrieben');
    vi.useRealTimers();
  });
});
