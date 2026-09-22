/**
 * Domain types for the BHFA 2027 working program.
 *
 * Times are stored as integer minutes from midnight of the session's calendar
 * day (`startMinute` / `endMinute`). Nothing in the app ever constructs a
 * Date from a session time, so no timezone can shift a session onto another
 * day. `endMinute` may reach 1440 (midnight) or beyond for events that run
 * past midnight — the Day 03 White Party ends at exactly 1440.
 */

export const SESSION_TYPES = [
  'scientific_session',
  'live_surgery',
  'cadaver_lab',
  'panel',
  'break',
  'breakfast',
  'lunch',
  'evening_event',
  'ceremony',
  'business',
  'other',
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  scientific_session: 'Scientific Session',
  live_surgery: 'Live Surgery',
  cadaver_lab: 'Cadaver Lab',
  panel: 'Panel',
  break: 'Break',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  evening_event: 'Evening Event',
  ceremony: 'Ceremony',
  business: 'Business / Practice Session',
  other: 'Other',
};

/** Types that are deliberately spaced apart from the teaching programme. */
export const EVENING_TYPES: SessionType[] = ['evening_event', 'ceremony'];

export const SPEAKER_ROLES = ['speaker', 'moderator', 'panelist'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

export const SPEAKER_STATUSES = ['confirmed', 'invited', 'tbd'] as const;
export type SpeakerStatus = (typeof SPEAKER_STATUSES)[number];

export const SPEAKER_STATUS_LABELS: Record<SpeakerStatus, string> = {
  confirmed: 'Confirmed',
  invited: 'Invited',
  tbd: 'TBD',
};

export const SESSION_STATUSES = ['draft', 'confirmed', 'tentative'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface SessionSpeaker {
  id: string;
  facultyId: string | null;
  /** Free-typed name; wins over the linked faculty record when present. */
  displayName: string | null;
  role: SpeakerRole;
  status: SpeakerStatus;
  sortOrder: number;
}

export interface Session {
  id: string;
  dayId: string;
  sortOrder: number;
  title: string;
  description: string | null;
  startMinute: number;
  endMinute: number;
  sessionType: SessionType;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  sponsorUrl: string | null;
  room: string | null;
  status: SessionStatus;
  internalNotes: string | null;
  speakers: SessionSpeaker[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface Day {
  id: string;
  programId: string;
  dayNumber: number;
  /** Calendar date as a plain ISO date string (YYYY-MM-DD). Never parsed as UTC. */
  date: string;
  weekdayLabel: string;
  /** Short label used by the day selector, e.g. "Endoscopic". */
  shortLabel: string;
  title: string;
  subtitle: string | null;
  /** Printed day window, e.g. "5:30 AM – 7:00 PM". Advisory only. */
  hoursLabel: string | null;
  sortOrder: number;
}

export interface Faculty {
  id: string;
  programId: string;
  name: string;
  credentials: string | null;
  headshotUrl: string | null;
}

export interface Program {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  locationLabel: string;
  dateRangeLabel: string;
}

export interface ProgramSnapshot {
  program: Program;
  days: Day[];
  sessions: Session[];
  faculty: Faculty[];
  /** Monotonic revision of the snapshot, bumped on every mutation. */
  revision: number;
}

export type HistoryAction =
  | 'session_created'
  | 'session_deleted'
  | 'session_reordered'
  | 'session_moved_day'
  | 'time_changed'
  | 'speakers_changed'
  | 'title_changed'
  | 'description_changed'
  | 'sponsor_changed'
  | 'details_changed'
  | 'day_changed'
  | 'bulk_time_shift'
  | 'restored'
  | 'undone';

export interface HistoryEntry {
  id: string;
  programId: string;
  sessionId: string | null;
  dayId: string | null;
  actorName: string;
  action: HistoryAction;
  summary: string;
  /** Prior state of whatever the action touched (session rows, ordering, times). */
  before: unknown;
  /** New state of whatever the action touched. */
  after: unknown;
  /** True when this entry has already been rolled back by an undo/restore. */
  undone: boolean;
  createdAt: string;
}

export interface PresenceEntry {
  clientId: string;
  name: string;
  sessionId: string | null;
  dayId: string | null;
  updatedAt: number;
}
