import { describe, expect, it } from 'vitest';
import {
  computeNextOccurrence,
  convertTemperature,
  formatTemperature,
  getCalendarMonthDays,
  getCalendarWeekDays,
  getTaskDueClassification,
  isStale,
} from './formatters';
import { PLANT_CATALOG } from './catalog';

describe('temperature helpers', () => {
  it('converts celsius to fahrenheit', () => {
    expect(formatTemperature(25, 'celsius')).toBe('25.0°C');
    expect(formatTemperature(25, 'fahrenheit')).toBe('77.0°F');
  });

  it('round-trips conversion', () => {
    const fahrenheit = convertTemperature(20, 'celsius', 'fahrenheit');
    expect(convertTemperature(fahrenheit, 'fahrenheit', 'celsius')).toBeCloseTo(20);
  });
});

describe('isStale', () => {
  it('detects stale readings', () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    expect(isStale('2026-10-20T11:00:00.000Z', 8, now)).toBe(false);
    expect(isStale('2026-10-20T01:00:00.000Z', 8, now)).toBe(true);
    expect(isStale('not-a-date', 8, now)).toBe(true);
  });
});

describe('getTaskDueClassification', () => {
  const ref = new Date('2026-10-24T12:00:00.000Z');

  it('classifies null or undefined due dates as none', () => {
    expect(getTaskDueClassification(null, ref)).toBe('none');
    expect(getTaskDueClassification(undefined, ref)).toBe('none');
    expect(getTaskDueClassification('invalid-date', ref)).toBe('none');
  });

  it('classifies dates before today as overdue', () => {
    expect(getTaskDueClassification('2026-10-23T23:59:59.000Z', ref)).toBe('overdue');
    expect(getTaskDueClassification('2026-10-20T08:00:00.000Z', ref)).toBe('overdue');
  });

  it('classifies dates falling today as today', () => {
    expect(getTaskDueClassification('2026-10-24T08:00:00.000Z', ref)).toBe('today');
    expect(getTaskDueClassification('2026-10-24T18:30:00.000Z', ref)).toBe('today');
  });

  it('classifies dates after today as upcoming', () => {
    expect(getTaskDueClassification('2026-10-25T01:00:00.000Z', ref)).toBe('upcoming');
    expect(getTaskDueClassification('2026-10-30T10:00:00.000Z', ref)).toBe('upcoming');
  });
});

describe('plant catalog', () => {
  it('has unique slugs and plausible ranges', () => {
    const slugs = PLANT_CATALOG.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of PLANT_CATALOG) {
      for (const range of Object.values(entry.referenceRanges)) {
        expect(range).toBeDefined();
        expect(range.min).toBeLessThan(range.max);
      }
    }
  });
});

describe('computeNextOccurrence', () => {
  it('advances by days accurately', () => {
    const base = new Date('2026-10-20T09:00:00.000Z');
    const next = computeNextOccurrence(base, 3, 'days');
    expect(next.toISOString()).toBe('2026-10-23T09:00:00.000Z');
  });

  it('advances by weeks accurately', () => {
    const base = new Date('2026-10-20T09:00:00.000Z');
    const next = computeNextOccurrence(base, 2, 'weeks');
    expect(next.toISOString()).toBe('2026-11-03T09:00:00.000Z');
  });

  it('advances by months accurately', () => {
    const base = new Date('2026-10-20T09:00:00.000Z');
    const next = computeNextOccurrence(base, 1, 'months');
    expect(next.toISOString()).toBe('2026-11-20T09:00:00.000Z');
  });

  it('throws on invalid fromDate', () => {
    expect(() => computeNextOccurrence('invalid-date', 1, 'days')).toThrow('Invalid fromDate');
  });
});

describe('calendar days generators', () => {
  const ref = new Date('2026-10-25T12:00:00.000Z');

  it('generates 42 days for month view starting on Sunday', () => {
    // October 2026 (month index 9)
    const days = getCalendarMonthDays(2026, 9, ref);
    expect(days).toHaveLength(42);
    // 2026-10-01 was a Thursday, so previous Sunday was Sep 27
    expect(days[0]?.dateStr).toBe('2026-09-27');
    expect(days[0]?.isCurrentMonth).toBe(false);

    // Verify today flag
    const todayCell = days.find((d) => d.dateStr === '2026-10-25');
    expect(todayCell?.isToday).toBe(true);
    expect(todayCell?.isCurrentMonth).toBe(true);
  });

  it('generates 7 days for week view containing reference date', () => {
    const week = getCalendarWeekDays(ref, ref);
    expect(week).toHaveLength(7);
    // Oct 25, 2026 is Sunday
    expect(week[0]?.dateStr).toBe('2026-10-25');
    expect(week[0]?.isToday).toBe(true);
    expect(week[6]?.dateStr).toBe('2026-10-31');
  });
});
