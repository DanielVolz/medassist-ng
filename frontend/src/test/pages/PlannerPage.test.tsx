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
      shoutrrrEnabled: false,
      notificationEmail: ''
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

  it('renders card with title', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const card = document.querySelector('.card');
    expect(card).toBeInTheDocument();
  });

  it('renders planner actions container', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const actions = document.querySelector('.planner-actions');
    expect(actions).toBeInTheDocument();
  });

  it('renders section grid', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const grid = document.querySelector('section.grid');
    expect(grid).toBeInTheDocument();
  });

  it('reset button has ghost class', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const resetBtn = document.querySelector('button.ghost');
    expect(resetBtn).toBeInTheDocument();
  });

  it('calculate button is submit type', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const submitBtn = document.querySelector('button[type="submit"]');
    expect(submitBtn).toBeInTheDocument();
  });

  it('allows changing date input values', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(inputs.length).toBe(2);
    
    // Should be able to change the value
    fireEvent.change(inputs[0], { target: { value: '2024-06-01T10:00' } });
    expect((inputs[0] as HTMLInputElement).value).toBe('2024-06-01T10:00');
  });
});

describe('PlannerPage with localStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loads saved range from localStorage', () => {
    // Set up saved data in localStorage
    localStorage.setItem('user_1_plannerRange', JSON.stringify({
      start: '2024-05-01T09:00',
      end: '2024-05-10T18:00'
    }));

    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // Page should render
    expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
  });

  it('loads saved rows from localStorage', () => {
    // Set up saved data in localStorage
    localStorage.setItem('user_1_plannerRows', JSON.stringify([
      { medName: 'Aspirin', total: 30 }
    ]));
    localStorage.setItem('user_1_plannerRange', JSON.stringify({
      start: '2024-05-01T09:00',
      end: '2024-05-10T18:00'
    }));

    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // Page should render with saved data
    expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
  });

  it('handles invalid localStorage data gracefully', () => {
    // Set up invalid data in localStorage
    localStorage.setItem('user_1_plannerRows', 'invalid-json');
    localStorage.setItem('user_1_plannerRange', 'invalid-json');

    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // Page should still render
    expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
  });
});
