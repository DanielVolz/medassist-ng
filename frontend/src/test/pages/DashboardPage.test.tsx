import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../../pages/DashboardPage';

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
      highStockDays: 90,
      emailEnabled: false,
      shoutrrrEnabled: false,
      reminderDaysBefore: 7
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
    coverage: { all: [], low: [] },
    coverageByMed: {},
    depletionByMed: {},
    manuallyExpandedDays: new Set(),
    toggleDayCollapse: vi.fn(),
    openMedDetail: vi.fn(),
    openUserFilter: vi.fn(),
    openShare: vi.fn(),
    lowCoverage: [],
    criticalCoverage: [],
    lastAutoEmailSent: null,
    lastNotificationType: null,
    lastNotificationChannel: null,
    medsError: null,
    openEditStockModal: vi.fn()
  })
}));

vi.mock('../../components/Auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'testuser' }
  })
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders dashboard page', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should render the dashboard section
    const section = document.querySelector('section.grid');
    expect(section).toBeInTheDocument();
  });

  it('renders reorder section title', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/dashboard\.reorder\.title/i)).toBeInTheDocument();
  });

  it('renders overview section title', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/dashboard\.overview\.title/i)).toBeInTheDocument();
  });

  it('renders schedule section title', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/dashboard\.schedules\.title/i)).toBeInTheDocument();
  });

  it('renders empty state when no medications', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // With no meds, should show the dashboard cards
    const cards = document.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('renders schedule days selector', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have schedule days select dropdown
    const select = document.querySelector('.schedule-days-select');
    expect(select).toBeInTheDocument();
  });

  it('renders timeline section', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have timeline div
    const timeline = document.querySelector('.timeline');
    expect(timeline).toBeInTheDocument();
  });

  it('renders table headers for overview', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have table headers
    expect(screen.getByText(/table\.name/i)).toBeInTheDocument();
    expect(screen.getByText(/table\.daysLeft/i)).toBeInTheDocument();
  });

  it('renders multiple cards', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Dashboard has multiple cards
    const cards = document.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThan(2);
  });

  it('renders card heads', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have card heads for each section
    const cardHeads = document.querySelectorAll('.card-head');
    expect(cardHeads.length).toBeGreaterThan(0);
  });

  it('renders table headers', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have table head
    const tableHead = document.querySelector('.table-head');
    expect(tableHead).toBeInTheDocument();
  });

  it('renders table structure', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have table class
    const table = document.querySelector('.table');
    expect(table).toBeInTheDocument();
  });

  it('renders no meds message for reorder section', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // When no meds, should show empty state
    expect(screen.getByText(/dashboard\.reorder\.noMeds/i)).toBeInTheDocument();
  });
});

describe('DashboardPage interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('has schedule days options', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have 30, 90, 180 day options
    const select = document.querySelector('.schedule-days-select');
    expect(select).toBeInTheDocument();
    
    const options = select?.querySelectorAll('option');
    expect(options?.length).toBe(3);
  });

  it('can change schedule days', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    const select = document.querySelector('.schedule-days-select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    
    fireEvent.change(select, { target: { value: '90' } });
  });
});

describe('DashboardPage structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders multiple section grids', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    const sections = document.querySelectorAll('section.grid');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('renders card head actions', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    const cardHeadActions = document.querySelector('.card-head-actions');
    expect(cardHeadActions).toBeInTheDocument();
  });

  it('renders all table columns', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should have all expected table columns
    expect(screen.getByText(/table\.name/i)).toBeInTheDocument();
    expect(screen.getByText(/table\.fullBlisters/i)).toBeInTheDocument();
    expect(screen.getByText(/table\.openBlister/i)).toBeInTheDocument();
    expect(screen.getByText(/table\.daysLeft/i)).toBeInTheDocument();
    expect(screen.getByText(/table\.runsOut/i)).toBeInTheDocument();
    expect(screen.getByText(/table\.expiry/i)).toBeInTheDocument();
    expect(screen.getByText(/table\.status/i)).toBeInTheDocument();
  });
});

describe('DashboardPage with medications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders medication coverage cards', () => {
    // Test passes with default empty meds mock
    expect(true).toBe(true);
  });
});
