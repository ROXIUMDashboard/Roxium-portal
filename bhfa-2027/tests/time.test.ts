import { describe, expect, it } from 'vitest';
import {
  MAX_END_MINUTE,
  MINUTES_IN_DAY,
  clampMinute,
  composeMinute,
  isNextDay,
  describeDelta,
  formatDuration,
  formatIsoDate,
  formatRange,
  formatTime,
  isValidMinute,
  parseTimeInput,
  toInputValue,
} from '@/lib/domain/time';

describe('formatTime', () => {
  it('renders 12-hour times the way the printed program does', () => {
    expect(formatTime(330)).toBe('5:30 AM');
    expect(formatTime(630)).toBe('10:30 AM');
    expect(formatTime(720)).toBe('12:00 PM');
    expect(formatTime(0)).toBe('12:00 AM');
    expect(formatTime(1140)).toBe('7:00 PM');
  });

  it('names midnight rather than showing 12:00 AM at the end of a day', () => {
    expect(formatTime(MINUTES_IN_DAY)).toBe('Midnight');
  });

  it('never produces NaN from a broken value', () => {
    expect(formatTime(Number.NaN)).toBe('—');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('parseTimeInput', () => {
  it('accepts the native time input format', () => {
    expect(parseTimeInput('09:30')).toBe(570);
    expect(parseTimeInput('00:00')).toBe(0);
    expect(parseTimeInput('23:59')).toBe(1439);
  });

  it('accepts typed 12-hour values and words', () => {
    expect(parseTimeInput('10:30 AM')).toBe(630);
    expect(parseTimeInput('1:30 pm')).toBe(810);
    expect(parseTimeInput('12:00 am')).toBe(0);
    expect(parseTimeInput('12:00 pm')).toBe(720);
    expect(parseTimeInput('midnight')).toBe(MINUTES_IN_DAY);
    expect(parseTimeInput('noon')).toBe(720);
  });

  it('returns null rather than a wrong number for unusable input', () => {
    for (const value of ['', 'lunch', '25:00', '10:75', '--']) {
      expect(parseTimeInput(value)).toBeNull();
    }
  });
});

describe('duration and range', () => {
  it('formats durations in the agenda style', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 hr');
    expect(formatDuration(165)).toBe('2 hr 45 min');
    expect(formatDuration(0)).toBe('0 min');
  });

  it('formats a range with an en dash', () => {
    expect(formatRange(630, 675)).toBe('10:30 AM – 11:15 AM');
  });

  it('describes a delta for the shift prompt', () => {
    expect(describeDelta(15)).toBe('15 min longer');
    expect(describeDelta(-30)).toBe('30 min shorter');
  });
});

describe('bounds', () => {
  it('validates minute values', () => {
    expect(isValidMinute(0)).toBe(true);
    expect(isValidMinute(MAX_END_MINUTE)).toBe(true);
    expect(isValidMinute(MAX_END_MINUTE + 1)).toBe(false);
    expect(isValidMinute(10.5)).toBe(false);
    expect(isValidMinute('600')).toBe(false);
  });

  it('clamps rather than throwing', () => {
    expect(clampMinute(-40)).toBe(0);
    expect(clampMinute(99_999)).toBe(MAX_END_MINUTE);
    expect(clampMinute(Number.NaN)).toBe(0);
  });

  it('shows midnight on the clock face as 00:00, never 23:59', () => {
    expect(toInputValue(330)).toBe('05:30');
    // The Day 03 White Party ends at exactly midnight.
    expect(toInputValue(MINUTES_IN_DAY)).toBe('00:00');
    expect(toInputValue(MINUTES_IN_DAY + 60)).toBe('01:00');
  });

  it('separates the clock time from the day it lands on', () => {
    expect(isNextDay(MINUTES_IN_DAY)).toBe(true);
    expect(isNextDay(MINUTES_IN_DAY - 1)).toBe(false);

    // Round-tripping midnight through the editor preserves 1440 exactly.
    expect(composeMinute(0, true)).toBe(MINUTES_IN_DAY);
    expect(composeMinute(MINUTES_IN_DAY, true)).toBe(MINUTES_IN_DAY);
    expect(composeMinute(MINUTES_IN_DAY, false)).toBe(0);
    expect(composeMinute(60, true)).toBe(MINUTES_IN_DAY + 60);
  });
});

describe('formatIsoDate', () => {
  it('formats the program dates without any timezone shift', () => {
    // Whatever the machine's timezone, September 9 2027 is a Thursday.
    expect(formatIsoDate('2027-09-09')).toBe('Thursday, September 9, 2027');
    expect(formatIsoDate('2027-09-12')).toBe('Sunday, September 12, 2027');
  });
});
