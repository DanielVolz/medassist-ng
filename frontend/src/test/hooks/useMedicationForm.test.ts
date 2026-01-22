import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultForm, defaultBlister } from '../../hooks/useMedicationForm';

describe('defaultBlister', () => {
  it('creates a blister with default values', () => {
    const blister = defaultBlister();
    expect(blister.usage).toBe('1');
    expect(blister.every).toBe('1');
    expect(blister.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(blister.startTime).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('defaultForm', () => {
  it('creates a form with default values', () => {
    const form = defaultForm();
    expect(form.name).toBe('');
    expect(form.genericName).toBe('');
    expect(form.takenBy).toEqual([]);
    expect(form.packCount).toBe('1');
    expect(form.blistersPerPack).toBe('1');
    expect(form.pillsPerBlister).toBe('1');
    expect(form.looseTablets).toBe('0');
    expect(form.pillWeightMg).toBe('');
    expect(form.expiryDate).toBe('');
    expect(form.notes).toBe('');
    expect(form.intakeRemindersEnabled).toBe(false);
    expect(form.blisters).toHaveLength(1);
  });
});
