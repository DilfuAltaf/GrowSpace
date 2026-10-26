import type { MeasurementType, TemperatureUnit } from './types';
import { MEASUREMENTS } from './constants';

const DEFAULT_LOCALE = 'en-US';

export function formatDate(iso: string | null | undefined, locale = DEFAULT_LOCALE): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined, locale = DEFAULT_LOCALE): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMeasurementValue(
  type: MeasurementType,
  value: number,
  unit: string,
): string {
  const meta = MEASUREMENTS[type];
  const maximumFractionDigits = type === 'air_temperature' ? 1 : 0;
  const formatted = new Intl.NumberFormat(DEFAULT_LOCALE, {
    maximumFractionDigits,
  }).format(value);
  return `${formatted}${unit || meta.unit}`;
}

export function toFahrenheit(celsius: number): number {
  return celsius * (9 / 5) + 32;
}

export function toCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) * (5 / 9);
}

export function convertTemperature(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit,
): number {
  if (from === to) return value;
  return from === 'celsius' ? toFahrenheit(value) : toCelsius(value);
}

export function formatTemperature(valueCelsius: number, unit: TemperatureUnit): string {
  const converted = unit === 'fahrenheit' ? toFahrenheit(valueCelsius) : valueCelsius;
  const suffix = unit === 'fahrenheit' ? '°F' : '°C';
  return `${converted.toFixed(1)}${suffix}`;
}

export function isStale(recordedAt: string, staleAfterHours: number, now = new Date()): boolean {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return true;
  const ageMs = now.getTime() - date.getTime();
  return ageMs > staleAfterHours * 60 * 60 * 1000;
}

export type TaskDueClassification = 'overdue' | 'today' | 'upcoming' | 'none';

/**
 * Classifies a task's due date relative to a reference point in time (defaults to now).
 */
export function getTaskDueClassification(
  dueAt: string | null | undefined,
  now = new Date(),
): TaskDueClassification {
  if (!dueAt) return 'none';
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 'none';

  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (dueDay < nowDay) {
    return 'overdue';
  }
  if (dueDay === nowDay) {
    return 'today';
  }
  return 'upcoming';
}

export function toLocalDateTimeInputValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localDateTimeToIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date/time');
  }
  return date.toISOString();
}

/**
 * Calculates the next occurrence timestamp given an initial/base date and recurring interval.
 */
export function computeNextOccurrence(
  fromDate: Date | string,
  intervalValue: number,
  intervalUnit: 'days' | 'weeks' | 'months',
): Date {
  const base = typeof fromDate === 'string' ? new Date(fromDate) : new Date(fromDate.getTime());
  if (Number.isNaN(base.getTime())) {
    throw new Error('Invalid fromDate for occurrence calculation');
  }
  const next = new Date(base.getTime());
  if (intervalUnit === 'days') {
    next.setUTCDate(next.getUTCDate() + intervalValue);
  } else if (intervalUnit === 'weeks') {
    next.setUTCDate(next.getUTCDate() + intervalValue * 7);
  } else if (intervalUnit === 'months') {
    next.setUTCMonth(next.getUTCMonth() + intervalValue);
  }
  return next;
}

export interface CalendarDay {
  date: Date;
  dateStr: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

/**
 * Generates an array of 42 calendar day descriptors for a given year and month (0-indexed).
 * Guaranteed to start on Sunday and end on Saturday to form a clean, complete 6-row calendar grid.
 */
export function getCalendarMonthDays(year: number, month: number, now = new Date()): CalendarDay[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startDayOfWeek = firstOfMonth.getUTCDay();

  const startUtc = new Date(Date.UTC(year, month, 1 - startDayOfWeek));
  const days: CalendarDay[] = [];

  for (let i = 0; i < 42; i++) {
    const d = new Date(startUtc.getTime());
    d.setUTCDate(startUtc.getUTCDate() + i);
    const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    days.push({
      date: d,
      dateStr,
      dayOfMonth: d.getUTCDate(),
      isCurrentMonth: d.getUTCMonth() === month,
      isToday: dateStr === todayStr,
    });
  }
  return days;
}

/**
 * Generates an array of 7 calendar day descriptors for the week containing centerDate.
 * Runs from Sunday to Saturday.
 */
export function getCalendarWeekDays(centerDate = new Date(), now = new Date()): CalendarDay[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  const dayOfWeek = centerDate.getUTCDay();
  const startOfWeek = new Date(
    Date.UTC(centerDate.getUTCFullYear(), centerDate.getUTCMonth(), centerDate.getUTCDate() - dayOfWeek),
  );

  const days: CalendarDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek.getTime());
    d.setUTCDate(startOfWeek.getUTCDate() + i);
    const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    days.push({
      date: d,
      dateStr,
      dayOfMonth: d.getUTCDate(),
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
    });
  }
  return days;
}
