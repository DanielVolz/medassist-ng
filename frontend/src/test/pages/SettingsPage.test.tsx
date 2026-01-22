import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../../pages/SettingsPage';

// Mock the context
vi.mock('../../context', () => ({
  useAppContext: () => ({
    settings: {
      lowStockThreshold: 30,
      criticalStockThreshold: 7,
      expiryWarningDays: 30,
      lowStockDays: 7,
      normalStockDays: 30,
      highStockDays: 90,
      emailEnabled: false,
      shoutrrrEnabled: false,
      smtpHost: '',
      smtpPort: 587,
      hasSmtpPassword: false,
      shoutrrrUrl: '',
      notificationEmail: '',
      emailStockReminders: false,
      shoutrrrStockReminders: false,
      emailIntakeReminders: false,
      shoutrrrIntakeReminders: false,
      reminderDaysBefore: 7,
      repeatRemindersEnabled: false,
      reminderRepeatIntervalMinutes: 30,
      maxNaggingReminders: 5,
      skipReminderIfTaken: true,
      skipRemindersForTakenDoses: false,
      stockCalculationMode: 'automatic',
      stockCheckTime: '08:00',
      intakeReminderTime: '09:00'
    },
    setSettings: vi.fn(),
    settingsLoading: false,
    settingsSaving: false,
    settingsSaved: false,
    saveSettings: vi.fn((e: Event) => e.preventDefault()),
    settingsChanged: false,
    testEmail: vi.fn(),
    testingEmail: false,
    testEmailResult: null,
    testShoutrrr: vi.fn(),
    testingShoutrrr: false,
    testShoutrrrResult: null,
    exporting: false,
    importing: false,
    showExportModal: false,
    setShowExportModal: vi.fn(),
    handleExport: vi.fn(),
    handleImportFileSelect: vi.fn(),
    showImportConfirm: false,
    setShowImportConfirm: vi.fn(),
    pendingImportData: null,
    setPendingImportData: vi.fn(),
    handleImportConfirm: vi.fn(),
    importResult: null,
    setImportResult: vi.fn()
  })
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders settings page', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    // Should render the settings form
    const form = document.querySelector('.settings-form');
    expect(form).toBeInTheDocument();
  });

  it('renders language section', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/settings\.language\.title/i)).toBeInTheDocument();
  });

  it('renders notifications section', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/settings\.notifications\.title/i)).toBeInTheDocument();
  });

  it('renders language select dropdown', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    const select = document.querySelector('.language-select');
    expect(select).toBeInTheDocument();
  });

  it('renders English and German language options', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/english/i)).toBeInTheDocument();
    expect(screen.getByText(/deutsch/i)).toBeInTheDocument();
  });

  it('renders notification matrix', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    const matrix = document.querySelector('.notification-matrix');
    expect(matrix).toBeInTheDocument();
  });

  it('renders stock settings section', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/settings\.stock\.title/i)).toBeInTheDocument();
  });

  it('renders multiple cards', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    const cards = document.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('renders section grid', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    const grid = document.querySelector('section.grid');
    expect(grid).toBeInTheDocument();
  });

  it('renders setting sections', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    const sections = document.querySelectorAll('.setting-section');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('renders toggle switches', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    const toggles = document.querySelectorAll('.toggle-switch');
    expect(toggles.length).toBeGreaterThan(0);
  });

  it('renders export/import section', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/exportImport\.title/i)).toBeInTheDocument();
  });

  it('renders notification channel headers', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    // Multiple email texts exist, so use getAllByText
    const emailTexts = screen.getAllByText(/settings\.notifications\.email/i);
    expect(emailTexts.length).toBeGreaterThan(0);
  });

  it('renders stock reminder text', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/settings\.notifications\.stockReminders/i)).toBeInTheDocument();
  });

  it('renders intake reminder text', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    expect(screen.getByText(/settings\.notifications\.intakeReminders/i)).toBeInTheDocument();
  });
});

describe('SettingsPage interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('can interact with language select', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    
    const select = document.querySelector('.language-select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select).not.toBeNull();
  });
});
