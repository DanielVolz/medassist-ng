import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SchedulePage } from '../../pages/SchedulePage';

// Mock the context
vi.mock('../../context', () => ({
  useAppContext: () => ({
    meds: [],
    settings: {
      lowStockThreshold: 30,
      criticalStockThreshold: 7,
      expiryWarningDays: 30,
      lowStockDays: 7,
      normalStockDays: 30,
      highStockDays: 90
    },
    scheduleDays: 30,
    setScheduleDays: vi.fn(),
    showPastDays: false,
    setShowPastDays: vi.fn(),
    pastDays: [],
    futureDays: [],
    takenDoses: new Set(),
    markDoseTaken: vi.fn(),
    undoDoseTaken: vi.fn(),
    coverageByMed: {},
    depletionByMed: {},
    manuallyExpandedDays: new Set(),
    toggleDayCollapse: vi.fn(),
    openUserFilter: vi.fn()
  })
}));

vi.mock('../../components/Auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'testuser' }
  })
}));

describe('SchedulePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders schedule page', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    // Should render the schedule section
    const section = document.querySelector('section.grid');
    expect(section).toBeInTheDocument();
  });

  it('renders schedule title', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/dashboard\.schedules\.title/i)).toBeInTheDocument();
  });

  it('renders day range selector', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    // Should have schedule days select dropdown
    const select = document.querySelector('.schedule-days-select');
    expect(select).toBeInTheDocument();
  });

  it('renders timeline section', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    // Should have timeline div
    const timeline = document.querySelector('.timeline');
    expect(timeline).toBeInTheDocument();
  });

  it('shows empty state when no medications', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    // With no meds, should show the schedule card but with empty timeline
    const card = document.querySelector('.card.schedule-full');
    expect(card).toBeInTheDocument();
  });
});
