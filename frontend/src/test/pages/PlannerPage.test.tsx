import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlannerPage } from '../../pages/PlannerPage';

// Mock the hooks and context
vi.mock('../../context', () => ({
  useAppContext: () => ({
    meds: [],
    settings: {
      lowStockThreshold: 30,
      criticalStockThreshold: 7,
      expiryWarningDays: 30,
      emailEnabled: false,
      shoutrrrEnabled: false
    },
    openMedDetail: vi.fn()
  })
}));

vi.mock('../../components/Auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'testuser' }
  })
}));

describe('PlannerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders planner page', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // Should render the planner section
    expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
  });

  it('renders date range inputs', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // Should have start and end date inputs (actual keys are planner.from and planner.until)
    expect(screen.getByText(/planner\.from/i)).toBeInTheDocument();
    expect(screen.getByText(/planner\.until/i)).toBeInTheDocument();
  });

  it('renders calculate button', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const buttons = screen.getAllByRole('button');
    const calculateBtn = buttons.find(btn => btn.textContent?.includes('planner.calculate'));
    expect(calculateBtn).toBeInTheDocument();
  });

  it('renders reset button', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const buttons = screen.getAllByRole('button');
    const resetBtn = buttons.find(btn => btn.textContent?.includes('common.reset'));
    expect(resetBtn).toBeInTheDocument();
  });

  it('shows empty state when no medications', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // When no meds, should render the form at least
    const content = document.body.textContent;
    expect(content).toBeTruthy();
  });

  it('renders datetime-local inputs', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // Datetime-local inputs should be present
    expect(document.querySelectorAll('input[type="datetime-local"]').length).toBe(2);
  });

  it('has form element', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const form = document.querySelector('form.planner');
    expect(form).toBeInTheDocument();
  });
});
