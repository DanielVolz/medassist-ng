import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SharedSchedule } from '../../components/SharedSchedule';

describe('SharedSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows loading state initially', () => {
    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <Routes>
          <Route path="/share/:token" element={<SharedSchedule />} />
        </Routes>
      </MemoryRouter>
    );
    
    // Should show loading state - actual translation key is common.loading
    expect(screen.getByText(/common\.loading/i)).toBeInTheDocument();
  });

  it('renders app title during loading', () => {
    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <Routes>
          <Route path="/share/:token" element={<SharedSchedule />} />
        </Routes>
      </MemoryRouter>
    );
    
    expect(screen.getByText(/MedAssist/i)).toBeInTheDocument();
  });

  it('renders shared schedule page container', () => {
    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <Routes>
          <Route path="/share/:token" element={<SharedSchedule />} />
        </Routes>
      </MemoryRouter>
    );
    
    const container = document.querySelector('.shared-schedule-page');
    expect(container).toBeInTheDocument();
  });

  it('renders loading state container', () => {
    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <Routes>
          <Route path="/share/:token" element={<SharedSchedule />} />
        </Routes>
      </MemoryRouter>
    );
    
    const loading = document.querySelector('.shared-schedule-loading');
    expect(loading).toBeInTheDocument();
  });

  it('has correct initial theme', () => {
    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <Routes>
          <Route path="/share/:token" element={<SharedSchedule />} />
        </Routes>
      </MemoryRouter>
    );
    
    // Default theme should be dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
