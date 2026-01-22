import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShare } from '../../hooks/useShare';
import type { Medication } from '../../types';

describe('useShare', () => {
  let mockAlert: ReturnType<typeof vi.fn>;
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    mockAlert = vi.fn();
    global.alert = mockAlert;
    
    mockClipboard = { writeText: vi.fn() };
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      writable: true
    });

    // Mock window.history
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    vi.spyOn(window.history, 'back').mockImplementation(() => {});

    // Mock window.location.origin
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:5173' },
      writable: true
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'test-token' })
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useShare());
    
    expect(result.current.showShareDialog).toBe(false);
    expect(result.current.sharePeople).toEqual([]);
    expect(result.current.shareSelectedPerson).toBe('');
    expect(result.current.shareSelectedDays).toBe(30);
    expect(result.current.shareLink).toBeNull();
  });

  it('opens share dialog with people from medications', () => {
    const { result } = renderHook(() => useShare());
    
    const meds: Medication[] = [
      { 
        id: 1, name: 'Med1', takenBy: ['Alice', 'Bob'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      },
      { 
        id: 2, name: 'Med2', takenBy: ['Bob', 'Charlie'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      }
    ];

    act(() => {
      result.current.openShareDialog(meds);
    });

    expect(result.current.showShareDialog).toBe(true);
    expect(result.current.sharePeople).toEqual(['Alice', 'Bob', 'Charlie']);
    expect(result.current.shareSelectedPerson).toBe('Alice');
    expect(window.history.pushState).toHaveBeenCalled();
  });

  it('resets state when opening dialog', () => {
    const { result } = renderHook(() => useShare());
    
    // Set some state first
    act(() => {
      result.current.setShareLink('old-link');
      result.current.setShareCopied(true);
    });

    const meds: Medication[] = [
      { 
        id: 1, name: 'Med1', takenBy: ['Alice'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      }
    ];

    act(() => {
      result.current.openShareDialog(meds);
    });

    expect(result.current.shareLink).toBeNull();
    expect(result.current.shareCopied).toBe(false);
  });

  it('generates share link', async () => {
    const { result } = renderHook(() => useShare());
    
    const meds: Medication[] = [
      { 
        id: 1, name: 'Med1', takenBy: ['Alice'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      }
    ];

    act(() => {
      result.current.openShareDialog(meds);
    });

    await act(async () => {
      await result.current.generateShareLink();
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/share',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ takenBy: 'Alice', scheduleDays: 30 })
      })
    );
    expect(result.current.shareLink).toBe('http://localhost:5173/share/test-token');
  });

  it('handles share link generation error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Failed to generate' })
    });

    const { result } = renderHook(() => useShare());
    
    const meds: Medication[] = [
      { 
        id: 1, name: 'Med1', takenBy: ['Alice'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      }
    ];

    act(() => {
      result.current.openShareDialog(meds);
    });

    await act(async () => {
      await result.current.generateShareLink();
    });

    expect(mockAlert).toHaveBeenCalled();
    expect(result.current.shareLink).toBeNull();
  });

  it('handles network error on share link generation', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useShare());
    
    const meds: Medication[] = [
      { 
        id: 1, name: 'Med1', takenBy: ['Alice'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      }
    ];

    act(() => {
      result.current.openShareDialog(meds);
    });

    await act(async () => {
      await result.current.generateShareLink();
    });

    expect(mockAlert).toHaveBeenCalled();
  });

  it('does nothing when generateShareLink called without selected person', async () => {
    const { result } = renderHook(() => useShare());
    
    // Don't open dialog, so shareSelectedPerson is empty
    await act(async () => {
      await result.current.generateShareLink();
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('copies share link to clipboard', async () => {
    const { result } = renderHook(() => useShare());
    
    act(() => {
      result.current.setShareLink('http://localhost:5173/share/test-token');
    });

    act(() => {
      result.current.copyShareLink();
    });

    expect(mockClipboard.writeText).toHaveBeenCalledWith('http://localhost:5173/share/test-token');
    expect(result.current.shareCopied).toBe(true);

    // Should reset after 2 seconds
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    
    expect(result.current.shareCopied).toBe(false);
  });

  it('does nothing when copyShareLink called without link', () => {
    const { result } = renderHook(() => useShare());
    
    act(() => {
      result.current.copyShareLink();
    });

    expect(mockClipboard.writeText).not.toHaveBeenCalled();
  });

  it('closes share dialog with history back', () => {
    const { result } = renderHook(() => useShare());
    
    const meds: Medication[] = [
      { 
        id: 1, name: 'Med1', takenBy: ['Alice'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      }
    ];

    act(() => {
      result.current.openShareDialog(meds);
    });

    act(() => {
      result.current.closeShareDialog();
    });

    expect(window.history.back).toHaveBeenCalled();
  });

  it('does not call history back when dialog not open', () => {
    const { result } = renderHook(() => useShare());
    
    act(() => {
      result.current.closeShareDialog();
    });

    expect(window.history.back).not.toHaveBeenCalled();
  });

  it('resetShareDialogState clears state', () => {
    const { result } = renderHook(() => useShare());
    
    const meds: Medication[] = [
      { 
        id: 1, name: 'Med1', takenBy: ['Alice'], 
        packCount: 1, blistersPerPack: 1, pillsPerBlister: 10, 
        looseTablets: 0, blisters: [], updatedAt: null
      }
    ];

    act(() => {
      result.current.openShareDialog(meds);
      result.current.setShareLink('some-link');
      result.current.setShareCopied(true);
    });

    act(() => {
      result.current.resetShareDialogState();
    });

    expect(result.current.showShareDialog).toBe(false);
    expect(result.current.shareLink).toBeNull();
    expect(result.current.shareCopied).toBe(false);
  });

  it('allows changing selected person and days', () => {
    const { result } = renderHook(() => useShare());
    
    act(() => {
      result.current.setShareSelectedPerson('Bob');
      result.current.setShareSelectedDays(90);
    });

    expect(result.current.shareSelectedPerson).toBe('Bob');
    expect(result.current.shareSelectedDays).toBe(90);
  });
});
