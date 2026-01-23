import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatNumber,
  formatDateTime,
  pad2,
  toIsoString,
  toDateValue,
  toTimeValue,
  combineDateAndTime,
  toInputValue,
  deriveTotal,
  getExpiryClass,
  getBlisterStock,
  formatFullBlisters,
  formatOpenBlisterAndLoose,
  compareSemver
} from '../../utils/formatters';
import type { Medication } from '../../types';

describe('formatNumber', () => {
  it('returns "—" for null', () => {
    expect(formatNumber(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatNumber(undefined)).toBe('—');
  });

  it('formats integer with no decimals', () => {
    expect(formatNumber(1234, 0)).toBe('1,234');
  });

  it('formats number with specified decimals', () => {
    expect(formatNumber(1234.5678, 2)).toBe('1,234.57');
  });

  it('formats zero correctly', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats negative numbers correctly', () => {
    expect(formatNumber(-500)).toBe('-500');
  });
});

describe('formatDateTime', () => {
  it('returns "-" for null', () => {
    expect(formatDateTime(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatDateTime(undefined)).toBe('-');
  });

  it('returns "-" for empty string', () => {
    expect(formatDateTime('')).toBe('-');
  });

  it('returns "-" for invalid date string', () => {
    expect(formatDateTime('not-a-date')).toBe('-');
  });

  it('formats valid ISO date string', () => {
    const result = formatDateTime('2024-03-15T10:30:00Z', 'en-US');
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/); // Contains date in some format
    expect(result).toMatch(/\d{1,2}:\d{2}/); // Contains time
  });
});

describe('pad2', () => {
  it('pads single digit with leading zero', () => {
    expect(pad2(5)).toBe('05');
  });

  it('keeps double digit as is', () => {
    expect(pad2(12)).toBe('12');
  });

  it('pads zero correctly', () => {
    expect(pad2(0)).toBe('00');
  });
});

describe('toIsoString', () => {
  it('converts Date to ISO string format', () => {
    const date = new Date(2024, 2, 15); // March 15, 2024
    expect(toIsoString(date)).toBe('2024-03-15');
  });

  it('pads single digit months and days', () => {
    const date = new Date(2024, 0, 5); // January 5, 2024
    expect(toIsoString(date)).toBe('2024-01-05');
  });
});

describe('toDateValue', () => {
  it('extracts date from ISO string', () => {
    expect(toDateValue('2024-03-15T10:30:00Z')).toBe('2024-03-15');
  });

  it('converts Date to date string', () => {
    const date = new Date(2024, 2, 15);
    expect(toDateValue(date)).toBe('2024-03-15');
  });
});

describe('toTimeValue', () => {
  it('extracts time from ISO string', () => {
    const result = toTimeValue('2024-03-15T10:30:00Z');
    // Time depends on timezone, just check format
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('extracts time from Date object', () => {
    const date = new Date(2024, 2, 15, 14, 45);
    expect(toTimeValue(date)).toBe('14:45');
  });
});

describe('combineDateAndTime', () => {
  it('combines date and time into ISO datetime', () => {
    expect(combineDateAndTime('2024-03-15', '10:30')).toBe('2024-03-15T10:30:00');
  });
});

describe('toInputValue', () => {
  it('converts Date to datetime-local input format', () => {
    const date = new Date(2024, 2, 15, 14, 30);
    expect(toInputValue(date)).toBe('2024-03-15T14:30');
  });

  it('converts ISO string to datetime-local input format', () => {
    const result = toInputValue('2024-03-15T14:30:00');
    // Format depends on timezone, but should be YYYY-MM-DDTHH:MM
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe('deriveTotal', () => {
  it('calculates total pills correctly', () => {
    expect(deriveTotal(2, 3, 10, 5)).toBe(65); // 2*3*10 + 5 = 65
  });

  it('handles zero values', () => {
    expect(deriveTotal(0, 0, 0, 0)).toBe(0);
  });

  it('handles only loose tablets', () => {
    expect(deriveTotal(0, 0, 0, 15)).toBe(15);
  });
});

describe('getExpiryClass', () => {
  let realDateNow: () => number;
  
  beforeEach(() => {
    realDateNow = Date.now;
    // Mock current date to a fixed point
    const fixedDate = new Date('2024-03-15T12:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedDate);
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    Date.now = realDateNow;
  });

  it('returns empty string for null', () => {
    expect(getExpiryClass(null, 30)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(getExpiryClass(undefined, 30)).toBe('');
  });

  it('returns danger-text for past date', () => {
    expect(getExpiryClass('2024-03-10', 30)).toBe('danger-text');
  });

  it('returns warning-text when within threshold', () => {
    expect(getExpiryClass('2024-03-25', 30)).toBe('warning-text');
  });

  it('returns success-text when expiry is far away', () => {
    expect(getExpiryClass('2024-06-15', 30)).toBe('success-text');
  });
});

describe('getBlisterStock', () => {
  it('calculates blister stock correctly', () => {
    const med: Medication = {
      id: 1,
      name: 'Test Med',
      packCount: 1,
      blistersPerPack: 2,
      pillsPerBlister: 10,
      looseTablets: 5,
      takenBy: [],
      blisters: [],
      updatedAt: null
    };
    
    const result = getBlisterStock(med);
    expect(result.fullBlisters).toBe(2); // 25 / 10 = 2
    expect(result.openBlisterPills).toBe(5); // 25 % 10 = 5
    expect(result.loosePills).toBe(5);
  });

  it('includes stock adjustment in calculation', () => {
    const med: Medication = {
      id: 1,
      name: 'Test Med',
      packCount: 1,
      blistersPerPack: 1,
      pillsPerBlister: 10,
      looseTablets: 0,
      stockAdjustment: -5,
      takenBy: [],
      blisters: [],
      updatedAt: null
    };
    
    const result = getBlisterStock(med);
    expect(result.fullBlisters).toBe(0); // 5 / 10 = 0
    expect(result.openBlisterPills).toBe(5); // 5 % 10 = 5
  });
});

describe('formatFullBlisters', () => {
  it('formats count without pill info', () => {
    expect(formatFullBlisters({ fullBlisters: 5, openBlisterPills: 3, loosePills: 3 })).toBe('5');
  });

  it('formats count with pill info', () => {
    expect(formatFullBlisters({ fullBlisters: 5, openBlisterPills: 3, loosePills: 3 }, 10)).toBe('5 (50)');
  });
});

describe('formatOpenBlisterAndLoose', () => {
  it('formats open blister pills count', () => {
    expect(formatOpenBlisterAndLoose({ fullBlisters: 5, openBlisterPills: 7, loosePills: 7 })).toBe('7');
  });
});

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns negative when a < b', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('1.2.3', '1.3.0')).toBeLessThan(0);
    expect(compareSemver('1.2.3', '2.0.0')).toBeLessThan(0);
  });

  it('returns positive when a > b', () => {
    expect(compareSemver('1.2.4', '1.2.3')).toBeGreaterThan(0);
    expect(compareSemver('1.3.0', '1.2.3')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.2.3')).toBeGreaterThan(0);
  });

  it('handles version prefixes', () => {
    expect(compareSemver('v1.2.3', 'v1.2.3')).toBe(0);
    expect(compareSemver('v1.2.3', '1.2.4')).toBeLessThan(0);
  });

  it('handles versions with different segment counts', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.2.3', '1.2')).toBeGreaterThan(0);
  });
});
