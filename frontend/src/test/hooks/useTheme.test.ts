import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../../hooks/useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    // Reset mock to default behavior
    (window.localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns dark as default theme', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('reads theme from localStorage', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('toggles theme from dark to light', () => {
    const { result } = renderHook(() => useTheme());
    
    expect(result.current.theme).toBe('dark');
    
    act(() => {
      result.current.toggleTheme();
    });
    
    expect(result.current.theme).toBe('light');
  });

  it('toggles theme from light to dark', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('light');
    const { result } = renderHook(() => useTheme());
    
    expect(result.current.theme).toBe('light');
    
    act(() => {
      result.current.toggleTheme();
    });
    
    expect(result.current.theme).toBe('dark');
  });

  it('saves theme to localStorage on change', () => {
    const { result } = renderHook(() => useTheme());
    
    act(() => {
      result.current.toggleTheme();
    });
    
    expect(window.localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  it('sets data-theme attribute on document', () => {
    const { result } = renderHook(() => useTheme());
    
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    
    act(() => {
      result.current.toggleTheme();
    });
    
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
