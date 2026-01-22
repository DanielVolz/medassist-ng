import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MedicationsPage } from '../../pages/MedicationsPage';

// Mock the hooks
vi.mock('../../hooks', () => ({
  useMedicationForm: () => ({
    form: {
      name: '',
      genericName: '',
      packCount: '0',
      blistersPerPack: '0',
      pillsPerBlister: '1',
      looseTablets: '0',
      takenBy: [],
      blisters: [{ usage: '1', every: '1', startDate: new Date().toISOString().slice(0, 10), startTime: '09:00', remindEnabled: false }],
      expiryDate: '',
      notes: '',
      pillWeightMg: '',
      intakeRemindersEnabled: false
    },
    setForm: vi.fn(),
    editingId: null,
    setEditingId: vi.fn(),
    formSaved: false,
    setFormSaved: vi.fn(),
    formChanged: false,
    fieldErrors: {},
    hasValidationErrors: false,
    takenByInput: '',
    setTakenByInput: vi.fn(),
    addTakenByPerson: vi.fn(),
    removeTakenByPerson: vi.fn(),
    handleTakenByKeyDown: vi.fn(),
    handleValueChange: vi.fn(),
    addBlister: vi.fn(),
    removeBlister: vi.fn(),
    setBlisterValue: vi.fn(),
    resetForm: vi.fn(),
    startEdit: vi.fn()
  })
}));

// Mock the context
vi.mock('../../context', () => ({
  useAppContext: () => ({
    meds: [],
    loading: false,
    saving: false,
    setSaving: vi.fn(),
    loadMeds: vi.fn(),
    deleteMed: vi.fn(),
    uploadMedImage: vi.fn(),
    deleteMedImage: vi.fn(),
    uploadingImage: false,
    existingPeople: [],
    refillPacks: '',
    setRefillPacks: vi.fn(),
    refillLoose: '',
    setRefillLoose: vi.fn(),
    refillSaving: false,
    submitRefill: vi.fn()
  })
}));

describe('MedicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders medications page', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    // Should render the medications section
    const section = document.querySelector('section.grid');
    expect(section).toBeInTheDocument();
  });

  it('renders medications list title', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/medications\.list\.title/i)).toBeInTheDocument();
  });

  it('renders form card on desktop', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    // Should have the form card with desktop-only class
    const formCard = document.querySelector('.card.form.desktop-only');
    expect(formCard).toBeInTheDocument();
  });

  it('renders form fields', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    // Should have commercial name field
    expect(screen.getByText(/form\.commercialName/i)).toBeInTheDocument();
  });

  it('renders stock fields', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    // Should have packs field
    expect(screen.getByText(/form\.packs/i)).toBeInTheDocument();
  });

  it('renders intake schedule section', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    // Should have intake schedule section
    expect(screen.getByText(/form\.blisters\.title/i)).toBeInTheDocument();
  });

  it('renders submit button', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    // Should have submit button
    const buttons = screen.getAllByRole('button');
    const submitBtn = buttons.find(btn => btn.getAttribute('type') === 'submit');
    expect(submitBtn).toBeInTheDocument();
  });

  it('renders medications list section', () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );
    
    // With no meds, should show the list section empty
    const listSection = document.querySelector('.med-list');
    expect(listSection).toBeInTheDocument();
  });
});
