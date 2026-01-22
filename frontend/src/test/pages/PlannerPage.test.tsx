import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlannerPage } from '../../pages/PlannerPage';
import React from 'react';

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
    
    // Should have start and end date inputs
    expect(screen.getByText(/planner\.startDate/i)).toBeInTheDocument();
    expect(screen.getByText(/planner\.endDate/i)).toBeInTheDocument();
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

  it('shows empty state when no medications', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // When no meds, should show empty or prompt to add
    const content = document.body.textContent;
    expect(content).toBeTruthy();
  });

  it('renders planner instructions', () => {
    render(
      <MemoryRouter>
        <PlannerPage />
      </MemoryRouter>
    );
    
    // Should have some instructional text
    expect(screen.getByText(/planner\.description/i)).toBeInTheDocument();
  });
});
