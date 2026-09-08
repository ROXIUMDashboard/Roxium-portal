/**
 * Schedule analysis: conflicts (red), gaps (amber), and the bulk time shift.
 * Pure functions over an ordered list of sessions for one day.
 */
import { EVENING_TYPES, type Session } from './types';
import { MAX_END_MINUTE, formatDuration } from './time';

/** Gaps shorter than this are ordinary turnaround time, not planning holes. */
export const GAP_MIN_MINUTES = 10;

export type SessionIssue =
  | { kind: 'invalid'; label: string; detail: string }
  | { kind: 'conflict'; label: string; detail: string; overlapMinutes: number; withSessionId: string }
  | { kind: 'gap'; label: string; detail: string; gapMinutes: number; afterSessionId: string };

export type IssueMap = Record<string, SessionIssue[]>;

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => (a.sortOrder - b.sortOrder) || a.id.localeCompare(b.id));
}

export function sessionsForDay(sessions: Session[], dayId: string): Session[] {
  return sortSessions(sessions.filter((s) => s.dayId === dayId));
}

export function isInvalid(session: Session): boolean {
  return (
    !Number.isInteger(session.startMinute) ||
    !Number.isInteger(session.endMinute) ||
    session.startMinute < 0 ||
    session.endMinute > MAX_END_MINUTE ||
    session.endMinute <= session.startMinute
  );
}

export function overlapMinutes(a: Session, b: Session): number {
  return Math.min(a.endMinute, b.endMinute) - Math.max(a.startMinute, b.startMinute);
}

/**
 * Analyse one day, in authored (sort) order.
 *
 * - Overlap with any earlier session → conflict (red) on the later session.
 * - end <= start → invalid (red).
 * - A gap after the previous session → advisory (amber), suppressed when the
 *   following session is an evening event or ceremony, where separation from
 *   the teaching programme is deliberate.
 */
export function analyseDay(daySessions: Session[]): IssueMap {
  const ordered = sortSessions(daySessions);
  const issues: IssueMap = {};
  const push = (id: string, issue: SessionIssue) => {
    (issues[id] ??= []).push(issue);
  };

  ordered.forEach((session, index) => {
    if (isInvalid(session)) {
      push(session.id, {
        kind: 'invalid',
        label: 'INVALID TIME',
        detail: 'The end time must come after the start time.',
      });
      return;
    }

    let worst: { overlap: number; other: Session } | null = null;
    for (let j = 0; j < index; j += 1) {
      const other = ordered[j];
      if (isInvalid(other)) continue;
      const overlap = overlapMinutes(session, other);
      if (overlap > 0 && (!worst || overlap > worst.overlap)) worst = { overlap, other };
    }

    if (worst) {
      push(session.id, {
        kind: 'conflict',
        label: `${formatDuration(worst.overlap).toUpperCase()} OVERLAP`,
        detail: `Overlaps “${worst.other.title || 'Untitled session'}”.`,
        overlapMinutes: worst.overlap,
        withSessionId: worst.other.id,
      });
      return;
    }

    const previous = index > 0 ? ordered[index - 1] : null;
    if (!previous || isInvalid(previous)) return;
    const gap = session.startMinute - previous.endMinute;
    if (gap < GAP_MIN_MINUTES) return;
    if (EVENING_TYPES.includes(session.sessionType)) return;

    push(session.id, {
      kind: 'gap',
      label: `${formatDuration(gap).toUpperCase()} UNSCHEDULED GAP`,
      detail: `Nothing is scheduled after “${previous.title || 'the previous session'}”.`,
      gapMinutes: gap,
      afterSessionId: previous.id,
    });
  });

  return issues;
}

export function analyseProgram(sessions: Session[], dayIds: string[]): IssueMap {
  return dayIds.reduce<IssueMap>((acc, dayId) => Object.assign(acc, analyseDay(sessionsForDay(sessions, dayId))), {});
}

export function conflictCountForDay(sessions: Session[], dayId: string): number {
  const issues = analyseDay(sessionsForDay(sessions, dayId));
  return Object.values(issues).filter((list) => list.some((i) => i.kind === 'conflict' || i.kind === 'invalid')).length;
}

export interface ShiftTarget {
  id: string;
  startMinute: number;
  endMinute: number;
}

/**
 * Move every session that comes after `afterSortOrder` on a day by `delta`
 * minutes, preserving each session's duration. Sessions that would fall outside
 * the representable range are clamped and reported so nothing silently breaks.
 */
export function computeShift(
  daySessions: Session[],
  afterSortOrder: number,
  delta: number,
): ShiftTarget[] {
  if (!Number.isInteger(delta) || delta === 0) return [];
  const following = sortSessions(daySessions).filter((s) => s.sortOrder > afterSortOrder);
  const targets: ShiftTarget[] = [];
  for (const session of following) {
    const duration = Math.max(session.endMinute - session.startMinute, 1);
    const startMinute = Math.min(Math.max(0, session.startMinute + delta), MAX_END_MINUTE - duration);
    const endMinute = startMinute + duration;
    if (startMinute !== session.startMinute || endMinute !== session.endMinute) {
      targets.push({ id: session.id, startMinute, endMinute });
    }
  }
  return targets;
}

/** Suggested fix: start this session where the previous one ends, same duration. */
export function computeSnapAfterPrevious(daySessions: Session[], sessionId: string): ShiftTarget | null {
  const ordered = sortSessions(daySessions);
  const index = ordered.findIndex((s) => s.id === sessionId);
  if (index <= 0) return null;
  const session = ordered[index];
  const previous = ordered[index - 1];
  const duration = Math.max(session.endMinute - session.startMinute, 5);
  const start = previous.endMinute;
  if (start === session.startMinute) return null;
  return {
    id: session.id,
    startMinute: start,
    endMinute: Math.min(start + duration, MAX_END_MINUTE),
  };
}
