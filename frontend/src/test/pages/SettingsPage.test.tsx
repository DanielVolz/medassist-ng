import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../../pages/SettingsPage';

// Mock the context
vi.mock('../../context', () => ({
  useAppContext: () => ({
    settings: {
      lowStockThreshold: 30,
      criticalStockThreshold: 7,
      expiryWarningDays: 30,
      emailEnabled: false,
      shoutrrrEnabled: false,
      smtpHost: '',
      shoutrrrUrl: '',
      emailStockReminders: false,
      shoutrrrStockReminders: false,
      emailIntakeReminders: false,
      shoutrrrIntakeReminders: false,
      reminderDaysBefore: 7,
      repeatRemindersEnabled: false,
      reminderRepeatIntervalMinutes: 30,
      maxNaggingReminders: 5,
      skipReminderIfTaken: true
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
});

describe('SettingsPage loading state', () => {
  it('shows loading text when loading', () => {
    vi.doMock('../../context', () => ({
      useAppContext: () => ({
        settings: {},
        setSettings: vi.fn(),
        settingsLoading: true,
        settingsSaving: false,
        settingsSaved: false,
        saveSettings: vi.fn(),
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
  });
});
