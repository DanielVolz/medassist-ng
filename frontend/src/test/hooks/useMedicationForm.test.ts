import { describe, it, expect } from 'vitest';
import { defaultForm, defaultBlister } from '../../hooks/useMedicationForm';

// Note: Hook tests were causing memory issues due to complex dependencies
// Testing only the exported utility functions to avoid heap overflow

describe('defaultBlister', () => {
  it('creates a blister with default values', () => {
    const blister = defaultBlister();
    expect(blister.usage).toBe('1');
    expect(blister.every).toBe('1');
    expect(blister.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(blister.startTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('uses current date', () => {
    const before = new Date();
    const blister = defaultBlister();
    const after = new Date();
    
    const blisterDate = new Date(blister.startDate);
    expect(blisterDate >= new Date(before.toISOString().slice(0, 10))).toBe(true);
    expect(blisterDate <= new Date(after.toISOString().slice(0, 10) + 'T23:59:59')).toBe(true);
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

  it('creates a blister in the form', () => {
    const form = defaultForm();
    expect(form.blisters).toHaveLength(1);
    expect(form.blisters[0].usage).toBe('1');
    expect(form.blisters[0].every).toBe('1');
  });

  it('creates independent forms', () => {
    const form1 = defaultForm();
    const form2 = defaultForm();
    
    form1.name = 'Test';
    expect(form2.name).toBe('');
  });

  it('creates independent blisters arrays', () => {
    const form1 = defaultForm();
    const form2 = defaultForm();
    
    form1.blisters.push(defaultBlister());
    expect(form2.blisters).toHaveLength(1);
  });

  it('creates independent takenBy arrays', () => {
    const form1 = defaultForm();
    const form2 = defaultForm();
    
    form1.takenBy.push('John');
    expect(form2.takenBy).toHaveLength(0);
  });
});
