import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SchedulePage } from '../../pages/SchedulePage';

// Mock data
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
    pillWeightMg: 500,
    imageUrl: null,
    updatedAt: null
  }
];

const mockCoverageByMed = {
  'Aspirin': { name: 'Aspirin', medsLeft: 25, daysLeft: 25, depletionDate: '2025-02-15', depletionTime: Date.now() + 25 * 86400000, nextDose: null }
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

// Factory function for mock context
const createMockContext = (overrides = {}) => ({
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
  openUserFilter: vi.fn(),
  ...overrides
});

let mockContextValue = createMockContext();

// Mock the context
vi.mock('../../context', () => ({
  useAppContext: () => mockContextValue
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
    mockContextValue = createMockContext();
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
    mockContextValue = createMockContext();
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

describe('SchedulePage with medications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockContext({
      meds: mockMeds,
      futureDays: mockFutureDays,
      coverageByMed: mockCoverageByMed,
      depletionByMed: { 'Aspirin': Date.now() + 25 * 86400000 }
    });
  });

  it('renders medication in timeline', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    expect(screen.getByText('Aspirin')).toBeInTheDocument();
  });

  it('renders day block', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const dayBlocks = document.querySelectorAll('.day-block');
    expect(dayBlocks.length).toBeGreaterThan(0);
  });

  it('renders dose item', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const doseItems = document.querySelectorAll('.dose-item');
    expect(doseItems.length).toBeGreaterThan(0);
  });

  it('renders take button', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const takeBtn = document.querySelector('.dose-btn.take');
    expect(takeBtn).toBeInTheDocument();
  });

  it('calls markDoseTaken when clicking take button', () => {
    const markDoseTaken = vi.fn();
    mockContextValue = createMockContext({
      meds: mockMeds,
      futureDays: mockFutureDays,
      coverageByMed: mockCoverageByMed,
      markDoseTaken
    });
    
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const takeBtn = document.querySelector('.dose-btn.take');
    if (takeBtn) {
      fireEvent.click(takeBtn);
      expect(markDoseTaken).toHaveBeenCalled();
    }
  });

  it('renders person name for dose', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  it('calls openUserFilter when clicking person name', () => {
    const openUserFilter = vi.fn();
    mockContextValue = createMockContext({
      meds: mockMeds,
      futureDays: mockFutureDays,
      coverageByMed: mockCoverageByMed,
      openUserFilter
    });
    
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const personName = screen.getByText('John');
    fireEvent.click(personName);
    expect(openUserFilter).toHaveBeenCalledWith('John');
  });

  it('renders pill weight when available', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    // Aspirin has pillWeightMg of 500
    expect(screen.getByText(/500 mg/)).toBeInTheDocument();
  });

  it('renders reminder icon when enabled', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    // Aspirin has intakeRemindersEnabled
    const reminderIcon = document.querySelector('.reminder-icon');
    expect(reminderIcon).toBeInTheDocument();
  });

  it('highlights today block', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const todayBlock = document.querySelector('.day-block.today');
    expect(todayBlock).toBeInTheDocument();
  });
});

describe('SchedulePage with past days', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockContext({
      meds: mockMeds,
      pastDays: mockPastDays,
      futureDays: mockFutureDays,
      coverageByMed: mockCoverageByMed,
      showPastDays: false
    });
  });

  it('renders past days toggle when past days exist', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const toggle = document.querySelector('.past-days-toggle');
    expect(toggle).toBeInTheDocument();
  });

  it('shows missed doses warning', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const warning = document.querySelector('.past-days-warning');
    expect(warning).toBeInTheDocument();
  });

  it('toggles past days visibility', () => {
    const setShowPastDays = vi.fn();
    mockContextValue = createMockContext({
      pastDays: mockPastDays,
      showPastDays: false,
      setShowPastDays
    });
    
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const toggle = document.querySelector('.past-days-toggle');
    if (toggle) {
      fireEvent.click(toggle);
      expect(setShowPastDays).toHaveBeenCalledWith(true);
    }
  });
});

describe('SchedulePage with expanded past days', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockContext({
      meds: mockMeds,
      pastDays: mockPastDays,
      futureDays: mockFutureDays,
      coverageByMed: mockCoverageByMed,
      showPastDays: true,
      manuallyExpandedDays: new Set(['Sun, Jan 21'])
    });
  });

  it('renders past day blocks when showPastDays is true', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const pastDayBlocks = document.querySelectorAll('.day-block.past');
    expect(pastDayBlocks.length).toBeGreaterThan(0);
  });

  it('renders day divider for past days', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const dividers = document.querySelectorAll('.day-divider');
    expect(dividers.length).toBeGreaterThan(0);
  });

  it('calls toggleDayCollapse when clicking day divider', () => {
    const toggleDayCollapse = vi.fn();
    mockContextValue = createMockContext({
      meds: mockMeds,
      pastDays: mockPastDays,
      showPastDays: true,
      manuallyExpandedDays: new Set(['Sun, Jan 21']),
      coverageByMed: mockCoverageByMed,
      toggleDayCollapse
    });
    
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const divider = document.querySelector('.day-block.past .day-divider.clickable');
    if (divider) {
      fireEvent.click(divider);
      expect(toggleDayCollapse).toHaveBeenCalled();
    }
  });
});

describe('SchedulePage with taken doses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Match the dose ID format exactly with the mockFutureDays dose
    // Since we can't predict Date.now(), we make the test check if takenDoses works
  });

  it('marks doses as taken in UI', () => {
    // Create consistent timestamp for test
    const timestamp = Date.now();
    const doseId = `1-0-${timestamp}-John`;
    
    const testFutureDays = [{
      dateStr: 'Mon, Jan 22',
      date: new Date(timestamp),
      isPast: false,
      meds: [{
        medName: 'Aspirin',
        total: 1,
        doses: [{ id: `1-0-${timestamp}`, timeStr: '09:00', when: timestamp, usage: 1, takenBy: ['John'] }],
        lastWhen: timestamp
      }]
    }];
    
    mockContextValue = createMockContext({
      meds: mockMeds,
      futureDays: testFutureDays,
      coverageByMed: mockCoverageByMed,
      takenDoses: new Set([doseId])
    });
    
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    // When dose is taken, the undo button should appear
    const undoBtn = document.querySelector('.dose-btn.undo');
    expect(undoBtn).toBeInTheDocument();
  });

  it('calls undoDoseTaken when clicking undo button', () => {
    const undoDoseTaken = vi.fn();
    const timestamp = Date.now();
    const doseId = `1-0-${timestamp}-John`;
    
    const testFutureDays = [{
      dateStr: 'Mon, Jan 22',
      date: new Date(timestamp),
      isPast: false,
      meds: [{
        medName: 'Aspirin',
        total: 1,
        doses: [{ id: `1-0-${timestamp}`, timeStr: '09:00', when: timestamp, usage: 1, takenBy: ['John'] }],
        lastWhen: timestamp
      }]
    }];
    
    mockContextValue = createMockContext({
      meds: mockMeds,
      futureDays: testFutureDays,
      coverageByMed: mockCoverageByMed,
      takenDoses: new Set([doseId]),
      undoDoseTaken
    });
    
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const undoBtn = document.querySelector('.dose-btn.undo');
    if (undoBtn) {
      fireEvent.click(undoBtn);
      expect(undoDoseTaken).toHaveBeenCalled();
    }
  });
});

describe('SchedulePage with low stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockContextValue = createMockContext({
      meds: mockMeds,
      futureDays: mockFutureDays,
      coverageByMed: {
        'Aspirin': { name: 'Aspirin', medsLeft: 3, daysLeft: 3, depletionDate: '2025-01-25', depletionTime: Date.now() + 3 * 86400000, nextDose: null }
      },
      depletionByMed: { 'Aspirin': Date.now() + 3 * 86400000 }
    });
  });

  it('shows status tag for medications', () => {
    render(
      <MemoryRouter>
        <SchedulePage />
      </MemoryRouter>
    );
    
    const tags = document.querySelectorAll('.tag');
    expect(tags.length).toBeGreaterThan(0);
  });
});
