import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MedDetailModal } from '../../components/MedDetailModal';
import type { Medication, Coverage, StockThresholds, RefillEntry } from '../../types';

const defaultSettings: StockThresholds = {
  lowStockDays: 7,
  normalStockDays: 30,
  highStockDays: 90
};

const mockMedication: Medication = {
  id: 1,
  name: 'Test Med',
  genericName: 'Generic Name',
  packCount: 1,
  blistersPerPack: 1,
  pillsPerBlister: 30,
  looseTablets: 0,
  takenBy: ['John'],
  blisters: [{ usage: 1, every: 1, start: '2024-01-01T09:00:00' }],
  updatedAt: null,
  expiryDate: '2025-12-31',
  notes: 'Test notes'
};

const mockCoverage: Coverage = {
  name: 'Test Med',
  medsLeft: 25,
  daysLeft: 25,
  depletionDate: '2024-04-01',
  depletionTime: Date.now() + 25 * 86400000,
  nextDose: null
};

const defaultProps = {
  selectedMed: mockMedication,
  coverage: { all: [mockCoverage] },
  settings: defaultSettings,
  showImageLightbox: false,
  showRefillModal: false,
  showEditStockModal: false,
  onClose: vi.fn(),
  onOpenImageLightbox: vi.fn(),
  onCloseImageLightbox: vi.fn(),
  onOpenRefillModal: vi.fn(),
  onCloseRefillModal: vi.fn(),
  onOpenEditStockModal: vi.fn(),
  onCloseEditStockModal: vi.fn(),
  refillPacks: 0,
  onRefillPacksChange: vi.fn(),
  refillLoose: 0,
  onRefillLooseChange: vi.fn(),
  refillSaving: false,
  refillHistory: [] as RefillEntry[],
  refillHistoryExpanded: false,
  onRefillHistoryExpandedChange: vi.fn(),
  onSubmitRefill: vi.fn(),
  editStockFullBlisters: 0,
  onEditStockFullBlistersChange: vi.fn(),
  editStockPartialBlisterPills: 0,
  onEditStockPartialBlisterPillsChange: vi.fn(),
  editStockSaving: false,
  onSubmitStockCorrection: vi.fn()
};

describe('MedDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when selectedMed is null', () => {
    render(<MedDetailModal {...defaultProps} selectedMed={null} />);
    
    expect(screen.queryByText('Test Med')).not.toBeInTheDocument();
  });

  it('renders modal when medication is selected', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    expect(screen.getByText('Test Med')).toBeInTheDocument();
  });

  it('displays medication name', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    expect(screen.getByText('Test Med')).toBeInTheDocument();
  });

  it('displays generic name', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    expect(screen.getByText('Generic Name')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    const closeBtn = screen.getByText('×');
    expect(closeBtn).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<MedDetailModal {...defaultProps} onClose={onClose} />);
    
    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
    
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn();
    render(<MedDetailModal {...defaultProps} onClose={onClose} />);
    
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
      fireEvent.click(overlay);
    }
    
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when modal content clicked', () => {
    const onClose = vi.fn();
    render(<MedDetailModal {...defaultProps} onClose={onClose} />);
    
    const content = document.querySelector('.modal-content');
    if (content) {
      fireEvent.click(content);
    }
    
    expect(onClose).not.toHaveBeenCalled();
  });

  it('displays notes when available', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    expect(screen.getByText('Test notes')).toBeInTheDocument();
  });

  it('displays schedule information', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    // Should have schedule section
    const scheduleSection = document.querySelector('.med-detail-schedules');
    expect(scheduleSection).toBeInTheDocument();
  });

  it('renders med detail header', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    const header = document.querySelector('.med-detail-header');
    expect(header).toBeInTheDocument();
  });

  it('renders med detail body', () => {
    render(<MedDetailModal {...defaultProps} />);
    
    const body = document.querySelector('.med-detail-body');
    expect(body).toBeInTheDocument();
  });
});

describe('MedDetailModal without coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('works without coverage data', () => {
    render(<MedDetailModal {...defaultProps} coverage={{ all: [] }} />);
    
    // Should still render the medication name
    expect(screen.getByText('Test Med')).toBeInTheDocument();
  });
});

describe('MedDetailModal without optional fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('works without generic name', () => {
    const med = { ...mockMedication, genericName: null };
    render(<MedDetailModal {...defaultProps} selectedMed={med} />);
    
    expect(screen.getByText('Test Med')).toBeInTheDocument();
  });

  it('works without notes', () => {
    const med = { ...mockMedication, notes: null };
    render(<MedDetailModal {...defaultProps} selectedMed={med} />);
    
    expect(screen.getByText('Test Med')).toBeInTheDocument();
  });

  it('works without takenBy', () => {
    const med = { ...mockMedication, takenBy: [] };
    render(<MedDetailModal {...defaultProps} selectedMed={med} />);
    
    expect(screen.getByText('Test Med')).toBeInTheDocument();
  });

  it('works without expiryDate', () => {
    const med = { ...mockMedication, expiryDate: null };
    render(<MedDetailModal {...defaultProps} selectedMed={med} />);
    
    expect(screen.getByText('Test Med')).toBeInTheDocument();
  });
});
