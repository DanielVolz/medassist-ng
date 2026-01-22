import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders card head', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const cardHead = document.querySelector('.card-head');
    expect(cardHead).toBeInTheDocument();
  });

  it('renders schedule days options', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const select = document.querySelector('.schedule-days-select');
    const options = select?.querySelectorAll('option');
    expect(options?.length).toBe(3);
  });

  it('has 30, 90, 180 day options', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/dashboard\.schedules\.1month/i)).toBeInTheDocument();
    expect(screen.getByText(/dashboard\.schedules\.3months/i)).toBeInTheDocument();
    expect(screen.getByText(/dashboard\.schedules\.6months/i)).toBeInTheDocument();
  });

  it('can change schedule days', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const select = document.querySelector('.schedule-days-select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    
    fireEvent.change(select, { target: { value: '90' } });
  });
});

describe('SchedulePage structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('has heading element', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const heading = document.querySelector('h2');
    expect(heading).toBeInTheDocument();
  });

  it('renders article element', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const article = document.querySelector('article');
    expect(article).toBeInTheDocument();
  });

  it('renders section element', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const section = document.querySelector('section');
    expect(section).toBeInTheDocument();
  });

  it('renders card with correct class', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const card = document.querySelector('.card.schedule-full');
    expect(card).toBeInTheDocument();
  });
});
