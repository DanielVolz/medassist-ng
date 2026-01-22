import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollapsedDays } from '../../hooks/useCollapsedDays';

describe('useCollapsedDays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (window.localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty sets initially when no userId', () => {
    const { result } = renderHook(() => useCollapsedDays(undefined));
    
    expect(result.current.manuallyCollapsedDays.size).toBe(0);
    expect(result.current.manuallyExpandedDays.size).toBe(0);
  });

  it('loads from localStorage when userId is provided', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === 'collapsedDays_user_1') return JSON.stringify(['2024-01-01']);
      if (key === 'expandedDays_user_1') return JSON.stringify(['2024-01-02']);
      return null;
    });

    const { result } = renderHook(() => useCollapsedDays(1));
    
    expect(result.current.manuallyCollapsedDays.has('2024-01-01')).toBe(true);
    expect(result.current.manuallyExpandedDays.has('2024-01-02')).toBe(true);
  });

  it('toggles collapsed day when not auto-collapsed', () => {
    const { result } = renderHook(() => useCollapsedDays(1));
    
    act(() => {
      result.current.toggleDayCollapse('2024-01-01', false);
    });
    
    expect(result.current.manuallyCollapsedDays.has('2024-01-01')).toBe(true);
    
    act(() => {
      result.current.toggleDayCollapse('2024-01-01', false);
    });
    
    expect(result.current.manuallyCollapsedDays.has('2024-01-01')).toBe(false);
  });

  it('toggles expanded day when auto-collapsed', () => {
    const { result } = renderHook(() => useCollapsedDays(1));
    
    act(() => {
      result.current.toggleDayCollapse('2024-01-01', true);
    });
    
    expect(result.current.manuallyExpandedDays.has('2024-01-01')).toBe(true);
    
    act(() => {
      result.current.toggleDayCollapse('2024-01-01', true);
    });
    
    expect(result.current.manuallyExpandedDays.has('2024-01-01')).toBe(false);
  });

  it('saves to localStorage when toggling with userId', () => {
    const { result } = renderHook(() => useCollapsedDays(1));
    
    act(() => {
      result.current.toggleDayCollapse('2024-01-01', false);
    });
    
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      'collapsedDays_user_1',
      expect.any(String)
    );
  });

  it('does not save to localStorage without userId', () => {
    const { result } = renderHook(() => useCollapsedDays(undefined));
    
    act(() => {
      result.current.toggleDayCollapse('2024-01-01', false);
    });
    
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });
});
