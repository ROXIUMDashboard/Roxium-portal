/**
 * Time helpers. Every session time in the app is an integer number of minutes
 * from midnight of that session's own calendar day. There is no Date object
 * anywhere in this file on purpose: a programme that runs 5:30 AM to midnight
 * must never be nudged by a browser timezone.
 */

export const MINUTES_IN_DAY = 24 * 60;
/** Latest representable end time: 5:00 AM the following morning. */
export const MAX_END_MINUTE = MINUTES_IN_DAY + 5 * 60;

export function isValidMinute(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_END_MINUTE;
}

export function clampMinute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_END_MINUTE, Math.max(0, Math.round(value)));
}

/** 570 → "9:30 AM", 720 → "12:00 PM", 1440 → "Midnight", 0 → "12:00 AM". */
export function formatTime(minute: number): string {
  if (!Number.isFinite(minute)) return '—';
  const m = clampMinute(minute);
  if (m === MINUTES_IN_DAY) return 'Midnight';
  const wrapped = m % MINUTES_IN_DAY;
  const hour24 = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/** Value for an <input type="time">: 570 → "09:30". Midnight clamps to 23:59. */
export function toInputValue(minute: number): string {
  const m = Math.min(clampMinute(minute), MINUTES_IN_DAY - 1);
  const wrapped = m % MINUTES_IN_DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * Parse an <input type="time"> value ("09:30") or a typed value
 * ("9:30 AM", "930", "midnight", "noon"). Returns null when unparseable so
 * callers can keep the previous value instead of writing NaN.
 */
export function parseTimeInput(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === 'midnight') return MINUTES_IN_DAY;
  if (value === 'noon') return 12 * 60;

  const match = value.match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm|a|p)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const mins = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.[0];

  if (!Number.isInteger(hour) || !Number.isInteger(mins) || mins > 59) return null;

  if (meridiem === 'p') {
    if (hour < 1 || hour > 12) return null;
    if (hour !== 12) hour += 12;
  } else if (meridiem === 'a') {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (hour === 24 && mins === 0) {
    return MINUTES_IN_DAY;
  } else if (hour > 23) {
    return null;
  }

  return hour * 60 + mins;
}

/** 45 → "45 min", 120 → "2 hr", 165 → "2 hr 45 min". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const total = Math.round(minutes);
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs} hr`;
  return `${hrs} hr ${mins} min`;
}

/** "10:30 AM – 11:15 AM" — en dash, matching the printed programme. */
export function formatRange(startMinute: number, endMinute: number): string {
  return `${formatTime(startMinute)} – ${formatTime(endMinute)}`;
}

/** Signed delta phrased for the smart-shift prompt: "15 minutes longer". */
export function describeDelta(deltaMinutes: number): string {
  const abs = Math.abs(deltaMinutes);
  const unit = formatDuration(abs);
  return deltaMinutes > 0 ? `${unit} longer` : `${unit} shorter`;
}

/** Short ISO date (YYYY-MM-DD) → "Thursday, September 9, 2027" with no timezone maths. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatIsoDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const [, y, m, d] = match;
  // Date.UTC keeps the weekday calculation timezone-independent.
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()];
  return `${weekday}, ${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}
