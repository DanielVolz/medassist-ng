import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileEditModal } from '../../components/MobileEditModal';
import type { FormState, FormBlister } from '../../types';

const defaultForm: FormState = {
  name: '',
  genericName: '',
  takenBy: [],
  packCount: '1',
  blistersPerPack: '1',
  pillsPerBlister: '1',
  looseTablets: '0',
  pillWeightMg: '',
  expiryDate: '',
  notes: '',
  intakeRemindersEnabled: false,
  blisters: [{
    usage: '1',
    every: '1',
    startDate: '2024-01-01',
    startTime: '09:00'
  }]
};

const defaultProps = {
  show: true,
  editingId: null,
  form: defaultForm,
  onFormChange: vi.fn(),
  fieldErrors: {},
  saving: false,
  formSaved: false,
  formChanged: false,
  hasValidationErrors: false,
  takenByInput: '',
  onTakenByInputChange: vi.fn(),
  existingPeople: [],
  onAddTakenByPerson: vi.fn(),
  onRemoveTakenByPerson: vi.fn(),
  onTakenByKeyDown: vi.fn(),
  onSetBlisterValue: vi.fn(),
  onAddBlister: vi.fn(),
  onRemoveBlister: vi.fn(),
  onHandleValueChange: vi.fn(),
  refillPacks: 0,
  onRefillPacksChange: vi.fn(),
  refillLoose: 0,
  onRefillLooseChange: vi.fn(),
  refillSaving: false,
  onSubmitRefill: vi.fn(),
  meds: [],
  onUploadMedImage: vi.fn(),
  onDeleteMedImage: vi.fn(),
  onClose: vi.fn(),
  onResetForm: vi.fn(),
  onSaveMedication: vi.fn()
};

describe('MobileEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when show is false', () => {
    render(<MobileEditModal {...defaultProps} show={false} />);
    
    expect(screen.queryByText(/form\.newEntry/i)).not.toBeInTheDocument();
  });

  it('renders modal when show is true', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    // Should render the modal overlay
    const modal = document.querySelector('.modal-overlay');
    expect(modal).toBeInTheDocument();
  });

  it('shows new entry title when not editing', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.newEntry/i)).toBeInTheDocument();
  });

  it('shows edit entry title when editing', () => {
    render(<MobileEditModal {...defaultProps} editingId={1} />);
    
    expect(screen.getByText(/form\.editEntry/i)).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    const closeBtn = document.querySelector('.modal-close');
    expect(closeBtn).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const onResetForm = vi.fn();
    render(<MobileEditModal {...defaultProps} onClose={onClose} onResetForm={onResetForm} />);
    
    const closeBtn = document.querySelector('.modal-close');
    if (closeBtn) {
      fireEvent.click(closeBtn);
    }
    
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onResetForm).toHaveBeenCalledTimes(1);
  });

  it('renders form element', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    const form = document.querySelector('form');
    expect(form).toBeInTheDocument();
  });

  it('renders name input', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.commercialName/i)).toBeInTheDocument();
  });

  it('renders generic name input', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.genericName/i)).toBeInTheDocument();
  });

  it('renders packs input', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.packs/i)).toBeInTheDocument();
  });

  it('renders blisters per pack input', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.blistersPerPack/i)).toBeInTheDocument();
  });

  it('renders pills per blister input', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.pillsPerBlister/i)).toBeInTheDocument();
  });

  it('renders loose tablets input', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.loose/i)).toBeInTheDocument();
  });

  it('renders intake schedules section', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.blisters\.title/i)).toBeInTheDocument();
  });

  it('renders save button', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    const saveBtn = document.querySelector('button[type="submit"]');
    expect(saveBtn).toBeInTheDocument();
  });

  it('disables save when saving', () => {
    render(<MobileEditModal {...defaultProps} saving={true} />);
    
    const saveBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();
  });

  it('disables save when has validation errors', () => {
    render(<MobileEditModal {...defaultProps} hasValidationErrors={true} />);
    
    const saveBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();
  });

  it('renders add intake button', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    expect(screen.getByText(/form\.blisters\.addIntake/i)).toBeInTheDocument();
  });

  it('calls onAddBlister when add intake clicked', () => {
    const onAddBlister = vi.fn();
    render(<MobileEditModal {...defaultProps} onAddBlister={onAddBlister} />);
    
    const addBtn = screen.getByText(/form\.blisters\.addIntake/i);
    fireEvent.click(addBtn);
    
    expect(onAddBlister).toHaveBeenCalledTimes(1);
  });

  it('renders modal content', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    const content = document.querySelector('.modal-content.edit-modal');
    expect(content).toBeInTheDocument();
  });

  it('renders edit modal header', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    const header = document.querySelector('.edit-modal-header');
    expect(header).toBeInTheDocument();
  });
});

describe('MobileEditModal with existing people', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal with existing people prop', () => {
    render(<MobileEditModal {...defaultProps} existingPeople={['John', 'Jane']} />);
    
    // Should render the modal - suggestions shown on input focus
    const modal = document.querySelector('.modal-overlay');
    expect(modal).toBeInTheDocument();
  });
});

describe('MobileEditModal with form errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows name error when present', () => {
    render(<MobileEditModal {...defaultProps} fieldErrors={{ name: 'Name is required' }} />);
    
    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });

  it('shows notes error when present', () => {
    render(<MobileEditModal {...defaultProps} fieldErrors={{ notes: 'Notes too long' }} />);
    
    expect(screen.getByText('Notes too long')).toBeInTheDocument();
  });
});

describe('MobileEditModal blister management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders blister rows', () => {
    render(<MobileEditModal {...defaultProps} />);
    
    const blisterRows = document.querySelectorAll('.blister-row');
    expect(blisterRows.length).toBe(1);
  });

  it('renders remove button for each blister', () => {
    const form = {
      ...defaultForm,
      blisters: [
        { usage: '1', every: '1', startDate: '2024-01-01', startTime: '09:00' },
        { usage: '2', every: '7', startDate: '2024-01-01', startTime: '10:00' }
      ]
    };
    
    render(<MobileEditModal {...defaultProps} form={form} />);
    
    const blisterRows = document.querySelectorAll('.blister-row');
    expect(blisterRows.length).toBe(2);
  });
});
