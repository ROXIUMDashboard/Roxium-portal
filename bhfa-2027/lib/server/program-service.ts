/**
 * The program service. Route handlers do transport (parse, authorise, respond);
 * every rule about *what a change means* lives here — which history entry it
 * writes, what other rows it touches, and what gets broadcast to collaborators.
 *
 * Both persistence drivers go through this file, so the memory driver and the
 * Supabase driver cannot drift apart in behaviour.
 */
import 'server-only';
import type {
  Day,
  Faculty,
  HistoryAction,
  HistoryEntry,
  ProgramSnapshot,
  Session,
} from '../domain/types';
import { FACULTY_REGION_LABELS, FACULTY_STATUS_LABELS, SESSION_TYPE_LABELS } from '../domain/types';
import { isActive, isInactive } from '../domain/faculty';
import { formatRange } from '../domain/time';
import { sessionsForDay, sortSessions, computeShift } from '../domain/schedule';
import { moveAcrossDays, moveWithinDay } from '../domain/ordering';
import type {
  DayPatch,
  FacultyInput,
  FacultyPatch,
  OrderAssignment,
  ProgramRepository,
  SessionInput,
  SessionPatch,
  TimeAssignment,
  WorkspaceRecord,
} from '../data/repository';
import { getRepository } from '../data';
import { hashToken, isPlausibleToken } from './tokens';
import { INSTANCE_ID, publish } from './realtime';
import { ValidationError } from './validate';

export class NotFoundError extends Error {
  readonly status = 404;
}

export interface Actor {
  name: string;
  clientId: string | null;
}

export interface ProgramContext {
  repository: ProgramRepository;
  workspace: WorkspaceRecord;
  actor: Actor;
}

/* --------------------------------------------------------------- workspace */

/** Resolve a collaboration token to a workspace, or null when it is not valid. */
export async function resolveWorkspace(token: string): Promise<WorkspaceRecord | null> {
  if (!isPlausibleToken(token)) return null;
  return getRepository().findWorkspaceByTokenHash(hashToken(token));
}

/* ----------------------------------------------------------- history shapes */

export type HistoryPayload =
  | { kind: 'session'; session: Session }
  | { kind: 'day'; day: Day }
  | { kind: 'faculty'; faculty: Faculty }
  | { kind: 'fields'; sessionId: string; fields: Partial<Session> }
  | { kind: 'order'; assignments: OrderAssignment[] }
  | { kind: 'times'; assignments: TimeAssignment[] }
  | { kind: 'none' };

function fieldsOf(session: Session, keys: (keyof Session)[]): Partial<Session> {
  const result: Partial<Session> = {};
  for (const key of keys) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[key] = session[key];
  }
  return result;
}

function orderOf(sessions: Session[]): OrderAssignment[] {
  return sortSessions(sessions).map((s) => ({ id: s.id, dayId: s.dayId, sortOrder: s.sortOrder }));
}

function timesOf(sessions: Session[], ids: string[]): TimeAssignment[] {
  const wanted = new Set(ids);
  return sessions
    .filter((s) => wanted.has(s.id))
    .map((s) => ({ id: s.id, startMinute: s.startMinute, endMinute: s.endMinute }));
}

/* ------------------------------------------------------------- broadcasting */

/**
 * Publish a change, and hand back the roster alongside the revision.
 *
 * A typed speaker name is promoted into the faculty table by `linkSpeakerNames`,
 * which stores a `facultyId` and clears `displayName`. Browsers resolve a
 * speaker's name through their own copy of the roster, so a name they have not
 * seen yet renders as "To be confirmed" until the page is reloaded. The snapshot
 * is already loaded here, so the current roster travels with every change.
 */
async function announce(
  context: ProgramContext,
  summary: string,
  upserted: Session[],
  deleted: string[] = [],
): Promise<{ revision: number; faculty: Faculty[]; days: Day[] }> {
  const snapshot = await context.repository.getSnapshot(context.workspace.programId);
  publish(context.workspace.programId, {
    type: 'mutation',
    revision: snapshot.revision,
    origin: INSTANCE_ID,
    actorClientId: context.actor.clientId,
    actorName: context.actor.name,
    summary,
    upserted,
    deleted,
    faculty: snapshot.faculty,
    days: snapshot.days,
  });
  return { revision: snapshot.revision, faculty: snapshot.faculty, days: snapshot.days };
}

export async function getSnapshot(context: ProgramContext): Promise<ProgramSnapshot> {
  return context.repository.getSnapshot(context.workspace.programId);
}

async function requireSession(context: ProgramContext, sessionId: string): Promise<Session> {
  const session = await context.repository.getSession(sessionId);
  if (!session) throw new NotFoundError('That session has already been removed by another collaborator.');
  return session;
}

async function requireDay(context: ProgramContext, dayId: string): Promise<Day> {
  const snapshot = await context.repository.getSnapshot(context.workspace.programId);
  const day = snapshot.days.find((d) => d.id === dayId);
  if (!day) throw new NotFoundError('That day is not part of this program.');
  return day;
}

/* -------------------------------------------------------------- speaker names */

/**
 * Speakers are typed as free text. Any new name is promoted into the faculty
 * table so it becomes a suggestion everywhere else in the programme — and so
 * headshots and profiles can be attached later without a data migration.
 */
async function linkSpeakerNames(context: ProgramContext, patch: SessionPatch): Promise<SessionPatch> {
  if (!patch.speakers?.length) return patch;
  const speakers = [];
  for (const speaker of patch.speakers) {
    if (speaker.displayName && !speaker.facultyId) {
      const faculty = await context.repository.upsertFacultyByName(
        context.workspace.programId,
        speaker.displayName,
      );
      speakers.push({ ...speaker, facultyId: faculty.id, displayName: null });
    } else {
      speakers.push(speaker);
    }
  }
  return { ...patch, speakers };
}

/* ----------------------------------------------------------------- mutations */

/**
 * What one collaborator overwrote when their save landed on a version someone
 * else had already saved. Nothing is lost — the prior state is in the history —
 * but the losing editor is told, and can put the other version back.
 */
export interface EditConflict {
  actorName: string;
  at: string;
  fields: { label: string; theirs: string; yours: string }[];
  /** The state that was overwritten, so the editor can review or restore it. */
  latest: Session;
}

const CONFLICT_LABELS: Record<string, string> = {
  title: 'Topic',
  description: 'Description',
  startMinute: 'Time',
  endMinute: 'Time',
  sessionType: 'Session type',
  sponsorName: 'Sponsor',
  sponsorUrl: 'Sponsor link',
  room: 'Room',
  internalNotes: 'Internal notes',
  speakers: 'Speakers',
};

function fieldSummary(session: Session, field: string, faculty: Faculty[]): string {
  switch (field) {
    case 'startMinute':
    case 'endMinute':
      return formatRange(session.startMinute, session.endMinute);
    case 'sessionType':
      return SESSION_TYPE_LABELS[session.sessionType];
    case 'speakers':
      return (
        session.speakers
          .map((s) => s.displayName ?? faculty.find((f) => f.id === s.facultyId)?.name ?? 'To be confirmed')
          .join(', ') || 'No speaker'
      );
    default: {
      const value = (session as unknown as Record<string, unknown>)[field];
      return typeof value === 'string' && value.trim() ? value : '—';
    }
  }
}

async function describeConflict(
  context: ProgramContext,
  before: Session,
  after: Session,
  touched: string[],
): Promise<EditConflict> {
  const faculty = await context.repository.listFaculty(context.workspace.programId);
  const seen = new Set<string>();
  const fields: EditConflict['fields'] = [];

  for (const field of touched) {
    const label = CONFLICT_LABELS[field] ?? field;
    if (seen.has(label)) continue;
    seen.add(label);
    const theirs = fieldSummary(before, field, faculty);
    const yours = fieldSummary(after, field, faculty);
    if (theirs !== yours) fields.push({ label, theirs, yours });
  }

  return {
    actorName: before.updatedBy ?? 'Another collaborator',
    at: before.updatedAt,
    fields,
    latest: before,
  };
}

export interface MutationResult {
  session?: Session;
  sessions?: Session[];
  deleted?: string[];
  revision: number;
  history: HistoryEntry | null;
  /**
   * Roster as of this change. A typed speaker name becomes a faculty row, and
   * browsers resolve speaker names through their own copy of the roster — so it
   * has to travel back with the change that created it.
   */
  faculty?: Faculty[];
  /** Days as of this change, so an edited day header reaches every browser. */
  days?: Day[];
  /** The faculty member a faculty mutation created, changed or removed. */
  facultyMember?: Faculty;
}

export async function createSession(
  context: ProgramContext,
  input: SessionInput & { afterSessionId: string | null },
): Promise<MutationResult> {
  const snapshot = await context.repository.getSnapshot(context.workspace.programId);
  await requireDay(context, input.dayId);

  const daySessions = sessionsForDay(snapshot.sessions, input.dayId);
  const afterIndex = input.afterSessionId
    ? daySessions.findIndex((s) => s.id === input.afterSessionId)
    : daySessions.length - 1;
  const insertAt = afterIndex === -1 ? daySessions.length : afterIndex + 1;

  const linked = await linkSpeakerNames(context, { speakers: input.speakers });
  const created = await context.repository.createSession(
    { ...input, speakers: linked.speakers ?? [], sortOrder: daySessions.length },
    context.actor.name,
  );

  // Slot it into place and renumber the day densely.
  const reordered = moveWithinDay([...daySessions, created], created.id, insertAt);
  if (reordered.length) await context.repository.applyOrder(reordered, context.actor.name);

  const fresh = await requireSession(context, created.id);
  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    sessionId: fresh.id,
    dayId: fresh.dayId,
    actorName: context.actor.name,
    action: 'session_created',
    summary: `Added “${fresh.title || 'Untitled session'}”`,
    before: { kind: 'none' } satisfies HistoryPayload,
    after: { kind: 'session', session: fresh } satisfies HistoryPayload,
  });

  const after = await context.repository.getSnapshot(context.workspace.programId);
  const { revision, faculty, days } = await announce(context, history.summary, sessionsForDay(after.sessions, fresh.dayId));
  return { session: fresh, revision, history, faculty, days };
}

function describeChange(before: Session, patch: SessionPatch): { action: HistoryAction; summary: string } {
  const title = before.title || 'Untitled session';
  if (patch.startMinute !== undefined || patch.endMinute !== undefined) {
    const start = patch.startMinute ?? before.startMinute;
    const end = patch.endMinute ?? before.endMinute;
    return { action: 'time_changed', summary: `${title} moved to ${formatRange(start, end)}` };
  }
  if (patch.speakers !== undefined) return { action: 'speakers_changed', summary: `Speakers updated on ${title}` };
  if (patch.title !== undefined) {
    return { action: 'title_changed', summary: `“${title}” renamed to “${patch.title || 'Untitled session'}”` };
  }
  if (patch.sponsorName !== undefined) {
    return {
      action: 'sponsor_changed',
      summary: patch.sponsorName ? `${title} supported by ${patch.sponsorName}` : `Sponsor removed from ${title}`,
    };
  }
  if (patch.description !== undefined) return { action: 'description_changed', summary: `Description updated on ${title}` };
  if (patch.sessionType !== undefined) {
    return { action: 'details_changed', summary: `${title} set to ${SESSION_TYPE_LABELS[patch.sessionType]}` };
  }
  return { action: 'details_changed', summary: `Details updated on ${title}` };
}

/** Fields that actually differ, so a no-op save never writes a history entry. */
function effectiveChanges(before: Session, patch: SessionPatch): SessionPatch {
  const changed: SessionPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'speakers') {
      const next = JSON.stringify(
        (value as SessionPatch['speakers'] ?? []).map((s) => [s.facultyId, s.displayName, s.role, s.status]),
      );
      const current = JSON.stringify(before.speakers.map((s) => [s.facultyId, s.displayName, s.role, s.status]));
      if (next !== current) changed.speakers = value as SessionPatch['speakers'];
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((before as any)[key] !== value) (changed as any)[key] = value;
  }
  return changed;
}

export async function updateSession(
  context: ProgramContext,
  sessionId: string,
  rawPatch: SessionPatch,
  baseUpdatedAt: string | null = null,
): Promise<MutationResult & { conflict?: EditConflict | null }> {
  const before = await requireSession(context, sessionId);
  const patch = await linkSpeakerNames(context, rawPatch);
  const changes = effectiveChanges(before, patch);

  if (Object.keys(changes).length === 0) {
    const snapshot = await context.repository.getSnapshot(context.workspace.programId);
    return { session: before, revision: snapshot.revision, history: null };
  }

  const { action, summary } = describeChange(before, changes);
  const updated = await context.repository.updateSession(sessionId, changes, context.actor.name);

  const touched = Object.keys(changes) as (keyof Session)[];
  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    sessionId,
    dayId: updated.dayId,
    actorName: context.actor.name,
    action,
    summary,
    before: { kind: 'fields', sessionId, fields: fieldsOf(before, touched) } satisfies HistoryPayload,
    after: { kind: 'fields', sessionId, fields: fieldsOf(updated, touched) } satisfies HistoryPayload,
  });

  // Did this save land on a version someone else had already written? The write
  // still goes through — refusing it would throw away the surgeon's typing — but
  // the editor is told exactly what it replaced.
  const stale =
    baseUpdatedAt !== null &&
    Date.parse(before.updatedAt) > Date.parse(baseUpdatedAt) &&
    before.updatedBy !== null &&
    before.updatedBy !== context.actor.name;

  const conflict = stale ? await describeConflict(context, before, updated, touched as string[]) : null;

  const { revision, faculty, days } = await announce(context, summary, [updated]);
  return { session: updated, revision, history, conflict, faculty, days };
}

/** Which day fields actually changed, phrased for the change history. */
const DAY_FIELD_LABELS: Record<keyof DayPatch, string> = {
  shortLabel: 'navigation label',
  title: 'title',
  subtitle: 'focus',
  weekdayLabel: 'weekday',
  date: 'date',
  hoursLabel: 'hours',
};

/**
 * Edit a day's own heading. These are the values the agenda prints above the
 * sessions and in the day selector; they live in bhfa_days, not in the code, so
 * a planner can correct them without a deploy.
 *
 * Reordering days is deliberately not part of this: sort order and calendar
 * date are separate concerns, and changing one must never silently change the
 * other.
 */
export async function updateDay(
  context: ProgramContext,
  dayId: string,
  patch: DayPatch,
): Promise<MutationResult> {
  const before = await context.repository.getDay(dayId);
  if (!before) throw new NotFoundError('That day no longer exists.');
  if (before.programId !== context.workspace.programId) {
    throw new NotFoundError('That day belongs to another programme.');
  }

  const changed = (Object.keys(patch) as (keyof DayPatch)[]).filter(
    (field) => patch[field] !== undefined && patch[field] !== before[field],
  );
  if (!changed.length) {
    const snapshot = await context.repository.getSnapshot(context.workspace.programId);
    return { revision: snapshot.revision, history: null, days: snapshot.days };
  }

  const after = await context.repository.updateDay(dayId, patch);

  const summary =
    `Day ${String(before.dayNumber).padStart(2, '0')}: ` +
    `${changed.map((field) => DAY_FIELD_LABELS[field]).join(', ')} changed`;

  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    dayId,
    actorName: context.actor.name,
    action: 'day_changed',
    summary,
    before: { kind: 'day', day: before } satisfies HistoryPayload,
    after: { kind: 'day', day: after } satisfies HistoryPayload,
  });

  // No session changed, but every browser needs the new heading.
  const { revision, faculty, days } = await announce(context, summary, []);
  return { revision, history, faculty, days };
}

export async function deleteSession(context: ProgramContext, sessionId: string): Promise<MutationResult> {
  const before = await requireSession(context, sessionId);
  const snapshot = await context.repository.getSnapshot(context.workspace.programId);
  const daySessions = sessionsForDay(snapshot.sessions, before.dayId);

  await context.repository.deleteSession(sessionId);
  const remaining = daySessions.filter((s) => s.id !== sessionId);
  await context.repository.applyOrder(orderOf(remaining).map((a, index) => ({ ...a, sortOrder: index })), context.actor.name);

  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    sessionId,
    dayId: before.dayId,
    actorName: context.actor.name,
    action: 'session_deleted',
    summary: `Deleted “${before.title || 'Untitled session'}”`,
    before: { kind: 'session', session: before } satisfies HistoryPayload,
    after: { kind: 'none' } satisfies HistoryPayload,
  });

  const after = await context.repository.getSnapshot(context.workspace.programId);
  const { revision, faculty, days } = await announce(context, history.summary, sessionsForDay(after.sessions, before.dayId), [sessionId]);
  return { deleted: [sessionId], revision, history, faculty, days };
}

export interface ReorderRequest {
  sessionId: string;
  targetDayId: string;
  targetIndex: number;
}

export async function reorderSession(context: ProgramContext, request: ReorderRequest): Promise<MutationResult> {
  const session = await requireSession(context, request.sessionId);
  const targetDay = await requireDay(context, request.targetDayId);
  const snapshot = await context.repository.getSnapshot(context.workspace.programId);

  const sourceSessions = sessionsForDay(snapshot.sessions, session.dayId);
  const sameDay = session.dayId === request.targetDayId;

  const assignments = sameDay
    ? moveWithinDay(sourceSessions, session.id, request.targetIndex)
    : moveAcrossDays(
        sourceSessions,
        sessionsForDay(snapshot.sessions, request.targetDayId),
        session.id,
        request.targetDayId,
        request.targetIndex,
      );

  if (!assignments.length) {
    return { session, revision: snapshot.revision, history: null };
  }

  const affectedIds = new Set(assignments.map((a) => a.id));
  const beforeOrder = orderOf(snapshot.sessions.filter((s) => affectedIds.has(s.id)));
  await context.repository.applyOrder(assignments, context.actor.name);

  const title = session.title || 'Untitled session';
  const summary = sameDay
    ? `Reordered “${title}”`
    : `Moved “${title}” to Day ${String(targetDay.dayNumber).padStart(2, '0')}`;

  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    sessionId: session.id,
    dayId: request.targetDayId,
    actorName: context.actor.name,
    action: sameDay ? 'session_reordered' : 'session_moved_day',
    summary,
    before: { kind: 'order', assignments: beforeOrder } satisfies HistoryPayload,
    after: { kind: 'order', assignments } satisfies HistoryPayload,
  });

  const after = await context.repository.getSnapshot(context.workspace.programId);
  const upserted = after.sessions.filter((s) => affectedIds.has(s.id));
  const { revision, faculty, days } = await announce(context, summary, upserted);
  return { sessions: upserted, revision, history, faculty, days };
}

export interface ShiftRequest {
  dayId: string;
  afterSessionId: string;
  deltaMinutes: number;
}

/**
 * "Shift following sessions" — every session after `afterSessionId` on that day
 * moves by `deltaMinutes`, keeping its own duration.
 */
export async function shiftFollowingSessions(context: ProgramContext, request: ShiftRequest): Promise<MutationResult> {
  if (!Number.isInteger(request.deltaMinutes) || request.deltaMinutes === 0) {
    throw new ValidationError('Nothing to shift.');
  }
  const anchor = await requireSession(context, request.afterSessionId);
  const snapshot = await context.repository.getSnapshot(context.workspace.programId);
  const daySessions = sessionsForDay(snapshot.sessions, request.dayId);
  const targets = computeShift(daySessions, anchor.sortOrder, request.deltaMinutes);

  if (!targets.length) {
    return { sessions: [], revision: snapshot.revision, history: null };
  }

  const beforeTimes = timesOf(daySessions, targets.map((t) => t.id));
  await context.repository.applyTimes(targets, context.actor.name);

  const direction = request.deltaMinutes > 0 ? 'later' : 'earlier';
  const summary = `Shifted ${targets.length} session${targets.length === 1 ? '' : 's'} ${Math.abs(
    request.deltaMinutes,
  )} min ${direction}`;

  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    sessionId: anchor.id,
    dayId: request.dayId,
    actorName: context.actor.name,
    action: 'bulk_time_shift',
    summary,
    before: { kind: 'times', assignments: beforeTimes } satisfies HistoryPayload,
    after: { kind: 'times', assignments: targets } satisfies HistoryPayload,
  });

  const after = await context.repository.getSnapshot(context.workspace.programId);
  const changed = new Set(targets.map((t) => t.id));
  const upserted = after.sessions.filter((s) => changed.has(s.id));
  const { revision, faculty, days } = await announce(context, summary, upserted);
  return { sessions: upserted, revision, history, faculty, days };
}

/** Apply a stored history payload as the current state. Used by undo and restore. */
async function applyPayload(context: ProgramContext, payload: HistoryPayload): Promise<{ upserted: Session[]; deleted: string[] }> {
  switch (payload.kind) {
    case 'none':
      return { upserted: [], deleted: [] };

    case 'session': {
      const existing = await context.repository.getSession(payload.session.id);
      const source = payload.session;
      const input: SessionInput = {
        id: source.id,
        dayId: source.dayId,
        sortOrder: source.sortOrder,
        title: source.title,
        description: source.description,
        startMinute: source.startMinute,
        endMinute: source.endMinute,
        sessionType: source.sessionType,
        sponsorName: source.sponsorName,
        sponsorLogoUrl: source.sponsorLogoUrl,
        sponsorUrl: source.sponsorUrl,
        room: source.room,
        status: source.status,
        internalNotes: source.internalNotes,
        speakers: source.speakers.map((s) => ({
          facultyId: s.facultyId,
          displayName: s.displayName,
          role: s.role,
          status: s.status,
        })),
      };
      const restored = existing
        ? await context.repository.updateSession(source.id, input, context.actor.name)
        : await context.repository.createSession(input, context.actor.name);
      return { upserted: [restored], deleted: [] };
    }

    case 'fields': {
      const existing = await context.repository.getSession(payload.sessionId);
      if (!existing) return { upserted: [], deleted: [] };
      const patch: SessionPatch = { ...(payload.fields as SessionPatch) };
      if (payload.fields.speakers) {
        patch.speakers = payload.fields.speakers.map((s) => ({
          facultyId: s.facultyId,
          displayName: s.displayName,
          role: s.role,
          status: s.status,
        }));
      }
      const updated = await context.repository.updateSession(payload.sessionId, patch, context.actor.name);
      return { upserted: [updated], deleted: [] };
    }

    case 'order': {
      await context.repository.applyOrder(payload.assignments, context.actor.name);
      const snapshot = await context.repository.getSnapshot(context.workspace.programId);
      const ids = new Set(payload.assignments.map((a) => a.id));
      return { upserted: snapshot.sessions.filter((s) => ids.has(s.id)), deleted: [] };
    }

    case 'times': {
      await context.repository.applyTimes(payload.assignments, context.actor.name);
      const snapshot = await context.repository.getSnapshot(context.workspace.programId);
      const ids = new Set(payload.assignments.map((a) => a.id));
      return { upserted: snapshot.sessions.filter((s) => ids.has(s.id)), deleted: [] };
    }

    case 'day': {
      const { shortLabel, title, subtitle, weekdayLabel, date, hoursLabel } = payload.day;
      await context.repository.updateDay(payload.day.id, { shortLabel, title, subtitle, weekdayLabel, date, hoursLabel });
      return { upserted: [], deleted: [] };
    }

    case 'faculty': {
      const input = facultyRestoreInput(payload.faculty);
      const existing = await context.repository.getFaculty(payload.faculty.id);
      if (existing) {
        const { id: _id, ...patch } = input;
        await context.repository.updateFaculty(payload.faculty.id, patch, context.actor.name);
      } else {
        await context.repository.createFaculty(context.workspace.programId, input, context.actor.name);
      }
      return { upserted: [], deleted: [] };
    }

    default:
      return { upserted: [], deleted: [] };
  }
}

/**
 * Roll a history entry back. Nothing is ever deleted from the history: the
 * rollback is itself recorded, so the audit trail only ever grows.
 */
export async function revertHistoryEntry(
  context: ProgramContext,
  entryId: string,
  mode: 'undo' | 'restore',
): Promise<MutationResult> {
  const entry = await context.repository.getHistoryEntry(entryId);
  if (!entry || entry.programId !== context.workspace.programId) {
    throw new NotFoundError('That change is no longer in the history.');
  }
  if (entry.undone && mode === 'undo') {
    throw new ValidationError('That change has already been undone.');
  }

  const payload = (entry.before ?? { kind: 'none' }) as HistoryPayload;
  const deleted: string[] = [];

  // Undoing a creation means removing the session again.
  if (entry.action === 'session_created' && payload.kind === 'none') {
    const after = entry.after as HistoryPayload;
    if (after?.kind === 'session') {
      await context.repository.deleteSession(after.session.id);
      deleted.push(after.session.id);
    }
  }

  if (entry.action === 'faculty_created' && payload.kind === 'none') {
    const after = entry.after as HistoryPayload;
    if (after?.kind === 'faculty') {
      const assignments = await context.repository.countFacultyAssignments(after.faculty.id);
      if (assignments > 0) {
        throw new ValidationError(
          `${after.faculty.name} is now on the agenda, so adding them can no longer be undone. ` +
            'Mark them Not Pursuing instead.',
        );
      }
      await context.repository.deleteFaculty(after.faculty.id);
    }
  }

  const applied = await applyPayload(context, payload);
  await context.repository.markHistoryUndone(entry.id);

  const summary =
    mode === 'undo' ? `Undid: ${entry.summary}` : `Restored the state before: ${entry.summary}`;
  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    sessionId: entry.sessionId,
    dayId: entry.dayId,
    facultyId: entry.facultyId ?? null,
    actorName: context.actor.name,
    action: mode === 'undo' ? 'undone' : 'restored',
    summary,
    before: entry.after,
    after: entry.before,
  });

  const { revision, faculty, days } = await announce(context, summary, applied.upserted, [...deleted, ...applied.deleted]);
  return { sessions: applied.upserted, deleted: [...deleted, ...applied.deleted], revision, history, faculty, days };
}

/* ------------------------------------------------------------------- faculty */

/** Everything a faculty history entry needs to put the record back verbatim. */
function facultyRestoreInput(f: Faculty): FacultyInput {
  return {
    id: f.id,
    name: f.name,
    credentials: f.credentials,
    headshotUrl: f.headshotUrl,
    status: f.status,
    region: f.region,
    city: f.city,
    stateProvince: f.stateProvince,
    country: f.country,
    specialty: f.specialty,
    proposedRole: f.proposedRole,
    invitationStatus: f.invitationStatus,
    invitationDate: f.invitationDate,
    lastContactDate: f.lastContactDate,
    owner: f.owner,
    priority: f.priority,
    internalNotes: f.internalNotes,
    email: f.email,
    phone: f.phone,
    institution: f.institution,
    website: f.website,
  };
}

async function requireFaculty(context: ProgramContext, facultyId: string): Promise<Faculty> {
  const member = await context.repository.getFaculty(facultyId);
  if (!member || member.programId !== context.workspace.programId) {
    throw new NotFoundError('That faculty member has already been removed by another collaborator.');
  }
  return member;
}

/** Names are unique per programme (case-insensitive), as the database enforces. */
async function assertNameFree(context: ProgramContext, name: string, exceptId?: string): Promise<void> {
  const roster = await context.repository.listFaculty(context.workspace.programId);
  const clash = roster.find((f) => f.id !== exceptId && f.name.toLowerCase() === name.trim().toLowerCase());
  if (clash) throw new ValidationError(`${clash.name} is already in the faculty register.`);
}

/**
 * The sentence the change history shows. Status moves are the ones a planner
 * scans for, so they read as movements between the active list and the
 * inactive section rather than as a field edit.
 */
function facultyChangeSummary(before: Faculty, after: Faculty, fields: string[]): string {
  const name = after.name || before.name;
  if (before.status !== after.status) {
    const to = after.status ? FACULTY_STATUS_LABELS[after.status] : 'unsorted';
    if (!isInactive(before) && isInactive(after)) return `${name} moved to ${to} (inactive)`;
    if (isInactive(before) && isActive(after)) return `${name} restored to ${to}`;
    if (!before.status && after.status) return `${name} added to the register as ${to}`;
    return `${name} marked ${to}`;
  }
  if (before.region !== after.region) {
    return `${name}: region set to ${after.region ? FACULTY_REGION_LABELS[after.region] : 'not set'}`;
  }
  if (before.name !== after.name) return `${before.name} renamed to ${after.name}`;
  return `${name}: ${fields.join(', ')} updated`;
}

const FACULTY_FIELD_LABELS: Record<keyof FacultyPatch, string> = {
  name: 'name',
  credentials: 'credentials',
  headshotUrl: 'headshot',
  status: 'status',
  region: 'region',
  city: 'city',
  stateProvince: 'state',
  country: 'country',
  specialty: 'specialty',
  proposedRole: 'proposed role',
  invitationStatus: 'invitation status',
  invitationDate: 'invitation date',
  lastContactDate: 'last contact',
  owner: 'owner',
  priority: 'priority',
  internalNotes: 'notes',
  email: 'email',
  phone: 'phone',
  institution: 'institution',
  website: 'website',
};

/**
 * Add someone to the faculty register. The browser supplies the id, so the row
 * it shows optimistically is the row that gets saved — nothing to reconcile.
 */
export async function createFaculty(context: ProgramContext, input: FacultyInput): Promise<MutationResult> {
  const name = input.name.trim();
  if (!name) throw new ValidationError('A faculty member needs a name.');
  await assertNameFree(context, name);
  if (input.id && (await context.repository.getFaculty(input.id))) {
    throw new ValidationError('That faculty member already exists.');
  }

  const created = await context.repository.createFaculty(
    context.workspace.programId,
    { ...input, name },
    context.actor.name,
  );
  const summary = `Added ${created.name} to the faculty register` +
    (created.status ? ` as ${FACULTY_STATUS_LABELS[created.status]}` : '');
  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    facultyId: created.id,
    actorName: context.actor.name,
    action: 'faculty_created',
    summary,
    before: { kind: 'none' } satisfies HistoryPayload,
    after: { kind: 'faculty', faculty: created } satisfies HistoryPayload,
  });
  const { revision, faculty, days } = await announce(context, summary, []);
  return { revision, history, faculty, days, facultyMember: created };
}

export async function updateFaculty(
  context: ProgramContext,
  facultyId: string,
  patch: FacultyPatch,
): Promise<MutationResult> {
  const before = await requireFaculty(context, facultyId);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ValidationError('A faculty member needs a name.');
    if (name.toLowerCase() !== before.name.toLowerCase()) await assertNameFree(context, name, facultyId);
    patch = { ...patch, name };
  }

  const changed = (Object.keys(patch) as (keyof FacultyPatch)[]).filter(
    (key) => patch[key] !== undefined && patch[key] !== before[key],
  );
  if (!changed.length) {
    const snapshot = await context.repository.getSnapshot(context.workspace.programId);
    return { revision: snapshot.revision, history: null, faculty: snapshot.faculty, facultyMember: before };
  }

  const after = await context.repository.updateFaculty(facultyId, patch, context.actor.name);
  const summary = facultyChangeSummary(before, after, changed.map((key) => FACULTY_FIELD_LABELS[key]));
  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    facultyId,
    actorName: context.actor.name,
    action: 'faculty_updated',
    summary,
    before: { kind: 'faculty', faculty: before } satisfies HistoryPayload,
    after: { kind: 'faculty', faculty: after } satisfies HistoryPayload,
  });
  // A rename changes how every session speaker linked to them resolves; the
  // roster carried by announce is what every browser resolves names through.
  const { revision, faculty, days } = await announce(context, summary, []);
  return { revision, history, faculty, days, facultyMember: after };
}

/**
 * Remove someone from the register entirely.
 *
 * Refused while they are on the agenda: the speaker link is `on delete set
 * null`, so their sessions would silently read "To be confirmed". Not Pursuing
 * is the way to take someone out of consideration without losing anything.
 */
export async function deleteFaculty(context: ProgramContext, facultyId: string): Promise<MutationResult> {
  const before = await requireFaculty(context, facultyId);
  const assignments = await context.repository.countFacultyAssignments(facultyId);
  if (assignments > 0) {
    throw new ValidationError(
      `${before.name} is on ${assignments} agenda session${assignments === 1 ? '' : 's'}. ` +
        'Mark them Not Pursuing, or take them off those sessions first.',
    );
  }
  await context.repository.deleteFaculty(facultyId);
  const summary = `Removed ${before.name} from the faculty register`;
  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    facultyId,
    actorName: context.actor.name,
    action: 'faculty_deleted',
    summary,
    before: { kind: 'faculty', faculty: before } satisfies HistoryPayload,
    after: { kind: 'none' } satisfies HistoryPayload,
  });
  const { revision, faculty, days } = await announce(context, summary, []);
  return { revision, history, faculty, days, facultyMember: before };
}

export async function listHistory(context: ProgramContext, limit = 120): Promise<HistoryEntry[]> {
  return context.repository.listHistory(context.workspace.programId, Math.min(Math.max(limit, 1), 300));
}
