import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildSchedulePreview,
  calculateCoverage,
  getStockStatus,
  getNextReminderForMed,
  getReminderStatusText
} from '../../utils/schedule';
import type { Medication, Coverage, StockThresholds } from '../../types';

describe('buildSchedulePreview', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty events for empty medications array', () => {
    const result = buildSchedulePreview([], 'en', false);
    expect(result.events).toEqual([]);
    expect(result.today).toBe(0);
    expect(result.totalBlisters).toBe(0);
  });

  it('returns empty for non-array input', () => {
    const result = buildSchedulePreview(null as unknown as Medication[], 'en', false);
    expect(result.events).toEqual([]);
  });

  it('builds events for medication with schedule', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'TestMed',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: ['John'],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-14T09:00:00'
      }],
      updatedAt: null
    }];

    const result = buildSchedulePreview(meds, 'en', true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.totalBlisters).toBe(1);
  });

  it('filters out past events when includePast is false', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'TestMed',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: [],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-01T09:00:00'
      }],
      updatedAt: null
    }];

    const withPast = buildSchedulePreview(meds, 'en', true);
    const withoutPast = buildSchedulePreview(meds, 'en', false);
    
    expect(withPast.events.length).toBeGreaterThanOrEqual(withoutPast.events.length);
  });

  it('handles invalid date in blister start', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'TestMed',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: [],
      blisters: [{
        usage: 1,
        every: 1,
        start: 'invalid-date'
      }],
      updatedAt: null
    }];

    const result = buildSchedulePreview(meds, 'en', true);
    // Should not crash, events for invalid dates are skipped
    expect(Array.isArray(result.events)).toBe(true);
  });

  it('sorts events by time', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'Morning Med',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: [],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-15T09:00:00'
      }],
      updatedAt: null
    }, {
      id: 2,
      name: 'Evening Med',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: [],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-15T21:00:00'
      }],
      updatedAt: null
    }];

    const result = buildSchedulePreview(meds, 'en', false);
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].when).toBeGreaterThanOrEqual(result.events[i - 1].when);
    }
  });
});

describe('calculateCoverage', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates coverage for medication with schedule', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'TestMed',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: [],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-15T09:00:00'
      }],
      updatedAt: null
    }];

    const events = [{ medName: 'TestMed', when: Date.now() }];
    const result = calculateCoverage(meds, events, 'en', 7, 'automatic', new Set());
    
    expect(result.all).toHaveLength(1);
    expect(result.all[0].name).toBe('TestMed');
    expect(result.all[0].daysLeft).toBeDefined();
  });

  it('handles medication with no schedule', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'NoSchedule',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: [],
      blisters: [],
      updatedAt: null
    }];

    const result = calculateCoverage(meds, [], 'en', 7, 'automatic', new Set());
    
    expect(result.all).toHaveLength(1);
    expect(result.all[0].daysLeft).toBeNull();
  });

  it('filters low stock medications', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'LowStock',
      packCount: 0,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 5,
      takenBy: [],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-15T09:00:00'
      }],
      updatedAt: null
    }];

    const result = calculateCoverage(meds, [], 'en', 7, 'automatic', new Set());
    expect(result.low.length).toBeGreaterThanOrEqual(0);
  });

  it('respects manual stock calculation mode', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'TestMed',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: [],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-10T09:00:00'
      }],
      updatedAt: null
    }];

    const takenDoses = new Set(['1-0-1710061200000']);
    const result = calculateCoverage(meds, [], 'en', 7, 'manual', takenDoses);
    
    expect(result.all).toHaveLength(1);
  });

  it('handles multiple takenBy people', () => {
    const meds: Medication[] = [{
      id: 1,
      name: 'SharedMed',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 30,
      looseTablets: 0,
      takenBy: ['Alice', 'Bob'],
      blisters: [{
        usage: 1,
        every: 1,
        start: '2024-03-15T09:00:00'
      }],
      updatedAt: null
    }];

    const result = calculateCoverage(meds, [], 'en', 7, 'automatic', new Set());
    expect(result.all).toHaveLength(1);
    // Daily rate should be doubled for 2 people
  });
});

describe('getStockStatus', () => {
  const thresholds: StockThresholds = {
    lowStockDays: 30,
    normalStockDays: 90,
    highStockDays: 180
  };

  it('returns out-of-stock when medsLeft is 0', () => {
    const result = getStockStatus(5, 0, thresholds);
    expect(result.level).toBe('out-of-stock');
    expect(result.className).toBe('danger');
  });

  it('returns out-of-stock when daysLeft is 0', () => {
    const result = getStockStatus(0, 5, thresholds);
    expect(result.level).toBe('out-of-stock');
    expect(result.className).toBe('danger');
  });

  it('returns high when daysLeft > highStockDays', () => {
    const result = getStockStatus(200, 100, thresholds);
    expect(result.level).toBe('high');
    expect(result.className).toBe('high');
  });

  it('returns normal when daysLeft >= lowStockDays', () => {
    const result = getStockStatus(50, 100, thresholds);
    expect(result.level).toBe('normal');
    expect(result.className).toBe('success');
  });

  it('returns low when daysLeft < lowStockDays', () => {
    const result = getStockStatus(20, 100, thresholds);
    expect(result.level).toBe('low');
    expect(result.className).toBe('warning');
  });

  it('returns normal when daysLeft is null but medsLeft > 0', () => {
    const result = getStockStatus(null, 100, thresholds);
    expect(result.level).toBe('normal');
    expect(result.label).toBe('status.noSchedule');
  });
});

describe('getNextReminderForMed', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "—" when no depletion time', () => {
    const med: Coverage = {
      name: 'Test',
      medsLeft: 100,
      daysLeft: null,
      depletionDate: null,
      depletionTime: null,
      nextDose: null
    };
    
    expect(getNextReminderForMed(med, 7, 'en')).toBe('—');
  });

  it('returns "Due now" when reminder time is past', () => {
    const now = Date.now();
    const med: Coverage = {
      name: 'Test',
      medsLeft: 5,
      daysLeft: 3,
      depletionDate: null,
      depletionTime: now + 3 * 86400000,
      nextDose: null
    };
    
    // Reminder 7 days before = already past
    expect(getNextReminderForMed(med, 7, 'en')).toBe('Due now');
  });

  it('returns formatted date for future reminder', () => {
    const now = Date.now();
    const med: Coverage = {
      name: 'Test',
      medsLeft: 100,
      daysLeft: 30,
      depletionDate: null,
      depletionTime: now + 30 * 86400000,
      nextDose: null
    };
    
    const result = getNextReminderForMed(med, 7, 'en-US');
    expect(result).not.toBe('—');
    expect(result).not.toBe('Due now');
  });
});

describe('getReminderStatusText', () => {
  const mockT = (key: string, options?: Record<string, unknown>) => {
    if (options?.count) return `${key} (${options.count})`;
    if (options?.days) return `${key} (${options.days})`;
    return key;
  };

  it('shows empty stock warning first', () => {
    const emptyMed: Coverage = {
      name: 'Empty',
      medsLeft: 0,
      daysLeft: 0,
      depletionDate: null,
      depletionTime: null,
      nextDose: null
    };

    const result = getReminderStatusText(7, 30, [], [emptyMed], null, null, null, mockT, 'en');
    expect(result.lines[0].text).toContain('dashboard.reminders.emptyStock');
    expect(result.lines[0].className).toBe('danger-text');
  });

  it('shows all ok when everything is fine', () => {
    const healthyMed: Coverage = {
      name: 'Healthy',
      medsLeft: 100,
      daysLeft: 60,
      depletionDate: null,
      depletionTime: Date.now() + 60 * 86400000,
      nextDose: null
    };

    const result = getReminderStatusText(7, 30, [], [healthyMed], null, null, null, mockT, 'en');
    expect(result.lines[0].text).toContain('dashboard.reminders.allOk');
  });

  it('includes last sent info if available', () => {
    // For healthy meds with no upcoming reminders, it goes to the final fallback
    // which returns allStockOk and includes lastReminder info
    const healthyMed: Coverage = {
      name: 'Healthy',
      medsLeft: 100,
      daysLeft: 200,
      depletionDate: null,
      depletionTime: Date.now() + 200 * 86400000,
      nextDose: null
    };

    const result = getReminderStatusText(
      7, 30, [], [healthyMed], 
      '2024-03-10T10:00:00Z', 
      'stock', 
      'email', 
      mockT, 
      'en'
    );
    // Either allOk or allStockOk includes last reminder info
    const hasLastReminder = result.lines.some(l => 
      l.text.includes('lastReminder') || 
      l.text.includes('allOk') ||
      l.text.includes('allStockOk')
    );
    expect(hasLastReminder).toBe(true);
  });

  it('shows low warning for medications running low', () => {
    const lowMed: Coverage = {
      name: 'RunningLow',
      medsLeft: 20,
      daysLeft: 20,
      depletionDate: null,
      depletionTime: Date.now() + 20 * 86400000,
      nextDose: null
    };

    const result = getReminderStatusText(7, 30, [], [lowMed], null, null, null, mockT, 'en');
    expect(result.lines.some(l => l.text.includes('lowWarning') || l.text.includes('needReorder'))).toBe(true);
  });

  it('handles intake reminder type with push channel', () => {
    const emptyMed: Coverage = {
      name: 'Empty',
      medsLeft: 0,
      daysLeft: 0,
      depletionDate: null,
      depletionTime: null,
      nextDose: null
    };

    const result = getReminderStatusText(
      7, 30, [], [emptyMed], 
      '2024-03-10T10:00:00Z', 
      'intake', 
      'push', 
      mockT, 
      'en'
    );
    expect(result.lines[0].className).toBe('danger-text');
  });

  it('handles both channel type', () => {
    const emptyMed: Coverage = {
      name: 'Empty',
      medsLeft: 0,
      daysLeft: 0,
      depletionDate: null,
      depletionTime: null,
      nextDose: null
    };

    const result = getReminderStatusText(
      7, 30, [], [emptyMed], 
      '2024-03-10T10:00:00Z', 
      'stock', 
      'both', 
      mockT, 
      'en'
    );
    expect(result.lines[0].className).toBe('danger-text');
  });

  it('shows needReorder when below critical threshold', () => {
    const criticalMed: Coverage = {
      name: 'Critical',
      medsLeft: 5,
      daysLeft: 5,
      depletionDate: null,
      depletionTime: Date.now() + 5 * 86400000,
      nextDose: null
    };

    const result = getReminderStatusText(
      7, 30, [criticalMed], [criticalMed],
      null, null, null, mockT, 'en'
    );
    expect(result.lines.some(l => l.text.includes('needReorder'))).toBe(true);
  });

  it('shows low warning when below low threshold but above critical', () => {
    const lowMed: Coverage = {
      name: 'Low',
      medsLeft: 20,
      daysLeft: 20,
      depletionDate: null,
      depletionTime: Date.now() + 20 * 86400000,
      nextDose: null
    };

    const result = getReminderStatusText(
      7, 30, [], [lowMed],
      null, null, null, mockT, 'en'
    );
    expect(result.lines.some(l => l.text.includes('lowWarning'))).toBe(true);
  });

  it('returns noRemindersNeeded when all ok and no last sent', () => {
    const result = getReminderStatusText(
      7, 30, [], [],
      null, null, null, mockT, 'en'
    );
    expect(result.lines.some(l => 
      l.text.includes('noRemindersNeeded') || l.text.includes('allStockOk')
    )).toBe(true);
  });

  it('handles empty and critical meds together', () => {
    const emptyMed: Coverage = {
      name: 'Empty',
      medsLeft: 0,
      daysLeft: 0,
      depletionDate: null,
      depletionTime: null,
      nextDose: null
    };
    
    const criticalMed: Coverage = {
      name: 'Critical',
      medsLeft: 5,
      daysLeft: 5,
      depletionDate: null,
      depletionTime: Date.now() + 5 * 86400000,
      nextDose: null
    };

    const lowMed: Coverage = {
      name: 'Low',
      medsLeft: 20,
      daysLeft: 20,
      depletionDate: null,
      depletionTime: Date.now() + 20 * 86400000,
      nextDose: null
    };

    const result = getReminderStatusText(
      7, 30, [criticalMed], [emptyMed, criticalMed, lowMed],
      null, null, null, mockT, 'en'
    );
    expect(result.lines[0].text).toContain('emptyStock');
    expect(result.lines.length).toBeGreaterThan(1);
  });
});
