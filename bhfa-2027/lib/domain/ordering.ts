/**
 * Ordering helpers. Sort orders are always rewritten as a dense 0..n-1
 * sequence so a reorder can never leave two sessions fighting over one slot.
 */
import type { Session } from './types';
import { sortSessions } from './schedule';

export interface OrderAssignment {
  id: string;
  dayId: string;
  sortOrder: number;
}

export function moveWithinDay(daySessions: Session[], sessionId: string, toIndex: number): OrderAssignment[] {
  const ordered = sortSessions(daySessions);
  const from = ordered.findIndex((s) => s.id === sessionId);
  if (from === -1) return [];
  const target = Math.min(Math.max(toIndex, 0), ordered.length - 1);
  if (target === from) return [];
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next.map((s, index) => ({ id: s.id, dayId: s.dayId, sortOrder: index }));
}

/**
 * Move a session to another day at `toIndex`. Times are deliberately left
 * untouched — the user decides afterwards whether to adjust them.
 */
export function moveAcrossDays(
  sourceSessions: Session[],
  targetSessions: Session[],
  sessionId: string,
  targetDayId: string,
  toIndex: number,
): OrderAssignment[] {
  const source = sortSessions(sourceSessions);
  const moved = source.find((s) => s.id === sessionId);
  if (!moved) return [];

  const remaining = source.filter((s) => s.id !== sessionId);
  const target = sortSessions(targetSessions).filter((s) => s.id !== sessionId);
  const insertAt = Math.min(Math.max(toIndex, 0), target.length);
  target.splice(insertAt, 0, { ...moved, dayId: targetDayId });

  return [
    ...remaining.map((s, index) => ({ id: s.id, dayId: s.dayId, sortOrder: index })),
    ...target.map((s, index) => ({ id: s.id, dayId: targetDayId, sortOrder: index })),
  ];
}

/** Where a brand-new session should sit, given the row it was added beneath. */
export function insertionOrder(daySessions: Session[], afterSessionId: string | null): OrderAssignment[] {
  const ordered = sortSessions(daySessions);
  if (!afterSessionId) return ordered.map((s, index) => ({ id: s.id, dayId: s.dayId, sortOrder: index + 1 }));
  const index = ordered.findIndex((s) => s.id === afterSessionId);
  if (index === -1) return [];
  return ordered.slice(index + 1).map((s, offset) => ({ id: s.id, dayId: s.dayId, sortOrder: index + 2 + offset }));
}
