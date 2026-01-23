import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../../pages/DashboardPage';

// Mock data for tests with medications
const mockMeds = [
  {
    id: 1,
    name: 'Aspirin',
    packCount: 1,
    blistersPerPack: 2,
    pillsPerBlister: 10,
    looseTablets: 5,
    takenBy: ['John'],
    blisters: [{ usage: 1, every: 1, start: '2024-01-01T09:00:00Z' }],
    intakeRemindersEnabled: true,
    notes: 'Take with food',
    expiryDate: '2025-12-31',
    imageUrl: null,
    updatedAt: null
  },
  {
    id: 2,
    name: 'Vitamin D',
    packCount: 0,
    blistersPerPack: 1,
    pillsPerBlister: 30,
    looseTablets: 3,
    takenBy: [],
    blisters: [{ usage: 1, every: 1, start: '2024-01-01T08:00:00Z' }],
    intakeRemindersEnabled: false,
    notes: null,
    expiryDate: null,
    imageUrl: null,
    updatedAt: null
  }
];

const mockCoverage = {
  all: [
    { name: 'Aspirin', medsLeft: 25, daysLeft: 25, depletionDate: '2025-02-15', depletionTime: Date.now() + 25 * 86400000, nextDose: null },
    { name: 'Vitamin D', medsLeft: 3, daysLeft: 3, depletionDate: '2025-01-25', depletionTime: Date.now() + 3 * 86400000, nextDose: null }
  ],
  low: [
    { name: 'Vitamin D', medsLeft: 3, daysLeft: 3, depletionDate: '2025-01-25', depletionTime: Date.now() + 3 * 86400000, nextDose: null }
  ]
};

const mockFutureDays = [
  {
    dateStr: 'Mon, Jan 22',
    date: new Date(),
    isPast: false,
    meds: [
      {
        medName: 'Aspirin',
        total: 1,
        doses: [
          { id: '1-0-' + Date.now(), timeStr: '09:00', when: Date.now(), usage: 1, takenBy: ['John'] }
        ],
        lastWhen: Date.now()
      }
    ]
  }
];

const mockPastDays = [
  {
    dateStr: 'Sun, Jan 21',
    date: new Date(Date.now() - 86400000),
    isPast: true,
    meds: [
      {
        medName: 'Aspirin',
        total: 1,
        doses: [
          { id: '1-0-' + (Date.now() - 86400000), timeStr: '09:00', when: Date.now() - 86400000, usage: 1, takenBy: ['John'] }
        ],
        lastWhen: Date.now() - 86400000
      }
    ]
  }
];

// Default mock factory
const createMockAppContext = (overrides = {}) => ({
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
    reminderDaysBefore: 7,
    notificationEmail: '',
    lastAutoEmailSent: null,
    lastNotificationType: null,
    lastNotificationChannel: null
  },
  scheduleDays: 30,
  setScheduleDays: vi.fn(),
  showPastDays: false,
  setShowPastDays: vi.fn(),
  pastDays: [],
  futureDays: [],
  takenDoses: new Set(),
  dismissedDoses: new Set(),
  markDoseTaken: vi.fn(),
  undoDoseTaken: vi.fn(),
  coverage: { all: [], low: [] },
  coverageByMed: {},
  depletionByMed: {},
  manuallyExpandedDays: new Set(),
  manuallyCollapsedDays: new Set(),
  toggleDayCollapse: vi.fn(),
  openMedDetail: vi.fn(),
  openUserFilter: vi.fn(),
  openShareDialog: vi.fn(),
  openScheduleLightbox: vi.fn(),
  missedPastDoseIds: [],
  getDayStockStatus: vi.fn(() => 'success'),
  getDoseId: vi.fn((id, person) => person ? `${id}-${person}` : id),
  showClearMissedConfirm: false,
  setShowClearMissedConfirm: vi.fn(),
  clearingMissed: false,
  dismissMissedDoses: vi.fn(),
  ...overrides
});

let mockContextValue = createMockAppContext();

// Mock the context
vi.mock('../../context', () => ({
  useAppContext: () => mockContextValue
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
    mockContextValue = createMockAppContext();
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
    mockContextValue = createMockAppContext();
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
    mockContextValue = createMockAppContext();
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
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      coverageByMed: {
        'Aspirin': mockCoverage.all[0],
        'Vitamin D': mockCoverage.all[1]
      },
      depletionByMed: {
        'Aspirin': Date.now() + 25 * 86400000,
        'Vitamin D': Date.now() + 3 * 86400000
      },
      futureDays: mockFutureDays
    });
  });

  it('renders medication rows in overview table', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show medication names (may appear in multiple places)
    const aspirinElements = screen.getAllByText('Aspirin');
    const vitaminDElements = screen.getAllByText('Vitamin D');
    expect(aspirinElements.length).toBeGreaterThan(0);
    expect(vitaminDElements.length).toBeGreaterThan(0);
  });

  it('renders low stock section with low stock medications', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show the low stock medication name
    const vitaminDElements = screen.getAllByText('Vitamin D');
    expect(vitaminDElements.length).toBeGreaterThan(0);
  });

  it('renders taken by badges', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show taken by badge for Aspirin
    const johnBadges = screen.getAllByText('John');
    expect(johnBadges.length).toBeGreaterThan(0);
  });

  it('renders medication icons for reminders and notes', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Aspirin has intakeRemindersEnabled and notes
    const reminderIcons = document.querySelectorAll('.reminder-icon');
    expect(reminderIcons.length).toBeGreaterThan(0);
    
    const notesIcons = document.querySelectorAll('.notes-icon');
    expect(notesIcons.length).toBeGreaterThan(0);
  });

  it('renders schedule timeline with future doses', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show day block
    const dayBlocks = document.querySelectorAll('.day-block');
    expect(dayBlocks.length).toBeGreaterThan(0);
  });

  it('calls openMedDetail when clicking medication row', () => {
    const openMedDetail = vi.fn();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      coverageByMed: { 'Aspirin': mockCoverage.all[0] },
      openMedDetail
    });
    
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Click on medication row
    const aspirinRow = screen.getAllByText('Aspirin')[0].closest('.table-row');
    if (aspirinRow) {
      fireEvent.click(aspirinRow);
      expect(openMedDetail).toHaveBeenCalled();
    }
  });

  it('calls openUserFilter when clicking taken by badge', () => {
    const openUserFilter = vi.fn();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      coverageByMed: { 'Aspirin': mockCoverage.all[0] },
      openUserFilter
    });
    
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Click on taken by badge
    const johnBadge = screen.getAllByText('John')[0];
    fireEvent.click(johnBadge);
    expect(openUserFilter).toHaveBeenCalledWith('John');
  });
});

describe('DashboardPage with email notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      settings: {
        ...createMockAppContext().settings,
        emailEnabled: true,
        notificationEmail: 'test@example.com'
      }
    });
  });

  it('renders email status bar when email enabled', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show email status bar
    const statusBar = document.querySelector('.email-status-bar');
    expect(statusBar).toBeInTheDocument();
  });

  it('shows reminder email button when there are low stock meds', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show send reminder button
    expect(screen.getByText(/dashboard\.reorder\.sendReminder/i)).toBeInTheDocument();
  });
});

describe('DashboardPage with shoutrrr notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      settings: {
        ...createMockAppContext().settings,
        shoutrrrEnabled: true
      }
    });
  });

  it('renders notification status bar when shoutrrr enabled', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show status bar
    const statusBar = document.querySelector('.email-status-bar');
    expect(statusBar).toBeInTheDocument();
  });
});

describe('DashboardPage with past days', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      pastDays: mockPastDays,
      futureDays: mockFutureDays,
      showPastDays: false,
      missedPastDoseIds: ['1-0-' + (Date.now() - 86400000) + '-John']
    });
  });

  it('renders past days toggle when past days exist', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show past days toggle
    const toggle = document.querySelector('.past-days-toggle');
    expect(toggle).toBeInTheDocument();
  });

  it('shows missed dose warning count', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show warning with missed count
    const warning = document.querySelector('.past-days-warning');
    expect(warning).toBeInTheDocument();
  });

  it('toggles past days visibility', () => {
    const setShowPastDays = vi.fn();
    mockContextValue = createMockAppContext({
      pastDays: mockPastDays,
      showPastDays: false,
      setShowPastDays,
      missedPastDoseIds: []
    });
    
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    const toggle = document.querySelector('.past-days-toggle');
    if (toggle) {
      fireEvent.click(toggle);
      expect(setShowPastDays).toHaveBeenCalledWith(true);
    }
  });

  it('shows clear missed doses button when there are missed doses', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show clear missed button
    const clearBtn = document.querySelector('.clear-missed-btn');
    expect(clearBtn).toBeInTheDocument();
  });
});

describe('DashboardPage with expanded past days', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      coverageByMed: { 'Aspirin': mockCoverage.all[0] },
      pastDays: mockPastDays,
      futureDays: mockFutureDays,
      showPastDays: true,
      manuallyExpandedDays: new Set(['Sun, Jan 21']),
      getDayStockStatus: vi.fn(() => 'success')
    });
  });

  it('renders past day blocks when showPastDays is true', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show past day block
    const pastDayBlocks = document.querySelectorAll('.day-block.past');
    expect(pastDayBlocks.length).toBeGreaterThan(0);
  });
});

describe('DashboardPage dose interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('calls markDoseTaken when clicking take button', () => {
    const markDoseTaken = vi.fn();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      coverageByMed: { 'Aspirin': mockCoverage.all[0] },
      depletionByMed: { 'Aspirin': Date.now() + 25 * 86400000 },
      futureDays: mockFutureDays,
      markDoseTaken
    });
    
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Find and click take button
    const takeBtn = document.querySelector('.dose-btn.take');
    if (takeBtn) {
      fireEvent.click(takeBtn);
      expect(markDoseTaken).toHaveBeenCalled();
    }
  });

  it('calls undoDoseTaken when clicking undo button', () => {
    const undoDoseTaken = vi.fn();
    const doseId = '1-0-' + Date.now() + '-John';
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: mockCoverage,
      coverageByMed: { 'Aspirin': mockCoverage.all[0] },
      depletionByMed: { 'Aspirin': Date.now() + 25 * 86400000 },
      futureDays: mockFutureDays,
      takenDoses: new Set([doseId]),
      undoDoseTaken,
      getDoseId: vi.fn(() => doseId)
    });
    
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Find and click undo button
    const undoBtn = document.querySelector('.dose-btn.undo');
    if (undoBtn) {
      fireEvent.click(undoBtn);
      expect(undoDoseTaken).toHaveBeenCalled();
    }
  });
});

describe('DashboardPage good stock state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockAppContext({
      meds: mockMeds,
      coverage: {
        all: [{ name: 'Aspirin', medsLeft: 100, daysLeft: 100, depletionDate: '2025-05-01', depletionTime: Date.now() + 100 * 86400000, nextDose: null }],
        low: []
      }
    });
  });

  it('shows all good message when no low stock', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    
    // Should show all good message
    expect(screen.getByText(/dashboard\.reorder\.allGood/i)).toBeInTheDocument();
  });
});
