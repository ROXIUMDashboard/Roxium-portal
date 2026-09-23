/**
 * Input validation and sanitisation for every mutation endpoint. Anything that
 * reaches the database has been through here.
 */
import {
  FACULTY_REGIONS,
  FACULTY_STATUSES,
  SESSION_STATUSES,
  SESSION_TYPES,
  SPEAKER_ROLES,
  SPEAKER_STATUSES,
  type SessionStatus,
  type SessionType,
  type SpeakerRole,
  type SpeakerStatus,
} from '../domain/types';
import { MAX_END_MINUTE } from '../domain/time';
import type {
  DayPatch,
  FacultyInput,
  FacultyPatch,
  SessionInput,
  SessionPatch,
  SpeakerInput,
} from '../data/repository';

export class ValidationError extends Error {
  readonly status = 400;
}

const LIMITS = {
  title: 200,
  description: 4000,
  internalNotes: 4000,
  sponsorName: 160,
  sponsorUrl: 500,
  room: 160,
  actorName: 80,
  speakerName: 160,
  speakers: 24,
} as const;

/** Trim, strip control characters, and cap length. Never throws on content. */
export function cleanText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ValidationError('Expected text.');
  const stripped = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!stripped) return null;
  return stripped.slice(0, max);
}

export function cleanActorName(value: unknown): string {
  const name = cleanText(value, LIMITS.actorName);
  return name || 'Someone';
}

export function requireMinute(value: unknown, field: string): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new ValidationError(`${field} must be a number of minutes.`);
  }
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > MAX_END_MINUTE) {
    throw new ValidationError(`${field} must fall between midnight and 5:00 AM the next morning.`);
  }
  return rounded;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} is not a recognised value.`);
  }
  return value as T;
}

export function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]{10,64}$/.test(value)) {
    throw new ValidationError(`${field} is missing or malformed.`);
  }
  return value;
}

/** Only http(s) links are stored, so a sponsor field can never become a script URL. */
export function cleanUrl(value: unknown): string | null {
  const text = cleanText(value, LIMITS.sponsorUrl);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ValidationError('Links must start with http:// or https://.');
    }
    return url.toString();
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('That does not look like a valid link.');
  }
}

export function parseSpeakers(value: unknown): SpeakerInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError('Speakers must be a list.');
  if (value.length > LIMITS.speakers) throw new ValidationError('That is more speakers than a session can hold.');

  return value.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const status: SpeakerStatus =
      entry.status === undefined ? 'confirmed' : requireEnum(entry.status, SPEAKER_STATUSES, 'Speaker status');
    const role: SpeakerRole =
      entry.role === undefined ? 'speaker' : requireEnum(entry.role, SPEAKER_ROLES, 'Speaker role');
    return {
      facultyId: entry.facultyId ? requireId(entry.facultyId, 'facultyId') : null,
      displayName: cleanText(entry.displayName ?? null, LIMITS.speakerName),
      role,
      status,
    };
  });
}

function parseSharedFields(body: Record<string, unknown>): SessionPatch {
  const patch: SessionPatch = {};
  if ('title' in body) patch.title = cleanText(body.title, LIMITS.title) ?? '';
  if ('description' in body) patch.description = cleanText(body.description, LIMITS.description);
  if ('startMinute' in body) patch.startMinute = requireMinute(body.startMinute, 'Start time');
  if ('endMinute' in body) patch.endMinute = requireMinute(body.endMinute, 'End time');
  if ('sessionType' in body) {
    patch.sessionType = requireEnum<SessionType>(body.sessionType, SESSION_TYPES, 'Session type');
  }
  if ('status' in body) {
    patch.status = requireEnum<SessionStatus>(body.status, SESSION_STATUSES, 'Session status');
  }
  if ('sponsorName' in body) patch.sponsorName = cleanText(body.sponsorName, LIMITS.sponsorName);
  if ('sponsorUrl' in body) patch.sponsorUrl = cleanUrl(body.sponsorUrl);
  if ('sponsorLogoUrl' in body) patch.sponsorLogoUrl = cleanUrl(body.sponsorLogoUrl);
  if ('room' in body) patch.room = cleanText(body.room, LIMITS.room);
  if ('internalNotes' in body) patch.internalNotes = cleanText(body.internalNotes, LIMITS.internalNotes);
  if ('speakers' in body) patch.speakers = parseSpeakers(body.speakers);
  return patch;
}

/**
 * The `updated_at` the editor was working from, used to detect a save landing
 * on top of a newer version. Anything unparseable is treated as "no baseline"
 * rather than an error — a missing baseline only costs the warning.
 */
export function parseBaseUpdatedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseSessionPatch(body: unknown): SessionPatch {
  if (!body || typeof body !== 'object') throw new ValidationError('Expected a session update.');
  const record = body as Record<string, unknown>;
  const patch = parseSharedFields(record);
  if ('dayId' in record) patch.dayId = requireId(record.dayId, 'dayId');
  if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to update.');
  return patch;
}

export function parseNewSession(body: unknown): SessionInput & { afterSessionId: string | null } {
  if (!body || typeof body !== 'object') throw new ValidationError('Expected a new session.');
  const record = body as Record<string, unknown>;
  const shared = parseSharedFields(record);

  const startMinute = shared.startMinute ?? requireMinute(record.startMinute, 'Start time');
  const endMinute = shared.endMinute ?? requireMinute(record.endMinute, 'End time');

  return {
    dayId: requireId(record.dayId, 'dayId'),
    sortOrder: 0,
    title: shared.title ?? '',
    description: shared.description ?? null,
    startMinute,
    endMinute,
    sessionType: shared.sessionType ?? 'scientific_session',
    sponsorName: shared.sponsorName ?? null,
    sponsorUrl: shared.sponsorUrl ?? null,
    sponsorLogoUrl: shared.sponsorLogoUrl ?? null,
    room: shared.room ?? null,
    status: shared.status ?? 'draft',
    internalNotes: shared.internalNotes ?? null,
    speakers: shared.speakers ?? [],
    afterSessionId: record.afterSessionId ? requireId(record.afterSessionId, 'afterSessionId') : null,
  };
}

/**
 * A day-header edit. Only the fields the editor actually sends are returned, so
 * an absent key leaves that column alone rather than blanking it.
 *
 * Title and navigation label are required to be non-empty when present — a day
 * with no name is not a state the agenda can render sensibly. Subtitle and hours
 * are optional and may be cleared.
 */
export function parseDayPatch(body: Record<string, unknown>): DayPatch {
  const patch: DayPatch = {};

  if ('shortLabel' in body) {
    const value = cleanText(body.shortLabel, 40);
    if (!value) throw new ValidationError('A day needs a short navigation label.');
    patch.shortLabel = value;
  }
  if ('title' in body) {
    const value = cleanText(body.title, 160);
    if (!value) throw new ValidationError('A day needs a title.');
    patch.title = value;
  }
  if ('weekdayLabel' in body) {
    const value = cleanText(body.weekdayLabel, 40);
    if (!value) throw new ValidationError('A day needs a weekday.');
    patch.weekdayLabel = value;
  }
  if ('subtitle' in body) patch.subtitle = cleanText(body.subtitle, 200);
  if ('hoursLabel' in body) patch.hoursLabel = cleanText(body.hoursLabel, 80);

  if ('date' in body) {
    const value = cleanText(body.date, 10);
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ValidationError('Enter the date as YYYY-MM-DD.');
    }
    // Reject 2027-02-31 and friends, which pass the shape test.
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new ValidationError('That date does not exist.');
    }
    patch.date = value;
  }

  return patch;
}

/* ------------------------------------------------------------------ faculty */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Length limits for the free-text faculty fields. */
const FACULTY_TEXT: Partial<Record<keyof FacultyPatch, number>> = {
  credentials: 120,
  city: 80,
  stateProvince: 80,
  country: 80,
  specialty: 160,
  proposedRole: 120,
  invitationStatus: 80,
  owner: 80,
  internalNotes: 4000,
  phone: 40,
  institution: 160,
};

function cleanDate(value: unknown, label: string): string | null {
  const text = cleanText(value, 10);
  if (!text) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ValidationError(`${label} must be a real date, written YYYY-MM-DD.`);
  }
  return text;
}

/** http(s) only; a bare domain gets https:// so "clinic.com" is accepted. */
function cleanWebAddress(value: unknown, label: string): string | null {
  const text = cleanText(value, 500);
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ValidationError(`${label} is not a valid web address.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError(`${label} must be a web address.`);
  }
  return url.toString();
}

/**
 * A faculty edit. Only keys present in the body are returned, so an absent key
 * leaves that column alone and an explicit null clears it.
 */
export function parseFacultyPatch(body: Record<string, unknown>): FacultyPatch {
  const patch: FacultyPatch = {};

  if ('name' in body) {
    const name = cleanText(body.name, 160);
    if (!name) throw new ValidationError('A faculty member needs a name.');
    patch.name = name;
  }
  for (const [key, max] of Object.entries(FACULTY_TEXT) as [keyof FacultyPatch, number][]) {
    if (key in body) (patch as Record<string, unknown>)[key] = cleanText(body[key], max);
  }
  if ('status' in body) {
    if (body.status !== null && !(FACULTY_STATUSES as readonly unknown[]).includes(body.status)) {
      throw new ValidationError('Unknown faculty status.');
    }
    patch.status = (body.status ?? null) as FacultyPatch['status'];
  }
  if ('region' in body) {
    if (body.region !== null && !(FACULTY_REGIONS as readonly unknown[]).includes(body.region)) {
      throw new ValidationError('Unknown region.');
    }
    patch.region = (body.region ?? null) as FacultyPatch['region'];
  }
  if ('priority' in body) {
    if (typeof body.priority !== 'boolean') throw new ValidationError('Priority is yes or no.');
    patch.priority = body.priority;
  }
  if ('invitationDate' in body) patch.invitationDate = cleanDate(body.invitationDate, 'Invitation date');
  if ('lastContactDate' in body) patch.lastContactDate = cleanDate(body.lastContactDate, 'Last contact');
  if ('website' in body) patch.website = cleanWebAddress(body.website, 'Website');
  if ('headshotUrl' in body) patch.headshotUrl = cleanWebAddress(body.headshotUrl, 'Headshot');
  if ('email' in body) {
    const email = cleanText(body.email, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError('That email address does not look right.');
    }
    patch.email = email;
  }
  return patch;
}

/** A new faculty member: a patch that must carry a name, plus an optional client id. */
export function parseFacultyInput(body: Record<string, unknown>): FacultyInput {
  const patch = parseFacultyPatch(body);
  if (!patch.name) throw new ValidationError('A faculty member needs a name.');
  const input: FacultyInput = { ...patch, name: patch.name };
  if (body.id !== undefined) {
    if (typeof body.id !== 'string' || !UUID.test(body.id)) throw new ValidationError('Invalid id.');
    input.id = body.id.toLowerCase();
  }
  return input;
}
