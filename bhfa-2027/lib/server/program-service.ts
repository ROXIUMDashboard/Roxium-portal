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
import { SESSION_TYPE_LABELS } from '../domain/types';
import { formatRange } from '../domain/time';
import { sessionsForDay, sortSessions, computeShift } from '../domain/schedule';
import { moveAcrossDays, moveWithinDay } from '../domain/ordering';
import type {
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
): Promise<{ revision: number; faculty: Faculty[] }> {
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
  });
  return { revision: snapshot.revision, faculty: snapshot.faculty };
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
  const { revision, faculty } = await announce(context, history.summary, sessionsForDay(after.sessions, fresh.dayId));
  return { session: fresh, revision, history, faculty };
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

  const { revision, faculty } = await announce(context, summary, [updated]);
  return { session: updated, revision, history, conflict, faculty };
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
  const { revision, faculty } = await announce(context, history.summary, sessionsForDay(after.sessions, before.dayId), [sessionId]);
  return { deleted: [sessionId], revision, history, faculty };
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
  const { revision, faculty } = await announce(context, summary, upserted);
  return { sessions: upserted, revision, history, faculty };
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
  const { revision, faculty } = await announce(context, summary, upserted);
  return { sessions: upserted, revision, history, faculty };
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

  const applied = await applyPayload(context, payload);
  await context.repository.markHistoryUndone(entry.id);

  const summary =
    mode === 'undo' ? `Undid: ${entry.summary}` : `Restored the state before: ${entry.summary}`;
  const history = await context.repository.addHistory({
    programId: context.workspace.programId,
    sessionId: entry.sessionId,
    dayId: entry.dayId,
    actorName: context.actor.name,
    action: mode === 'undo' ? 'undone' : 'restored',
    summary,
    before: entry.after,
    after: entry.before,
  });

  const { revision, faculty } = await announce(context, summary, applied.upserted, [...deleted, ...applied.deleted]);
  return { sessions: applied.upserted, deleted: [...deleted, ...applied.deleted], revision, history, faculty };
}

export async function listHistory(context: ProgramContext, limit = 120): Promise<HistoryEntry[]> {
  return context.repository.listHistory(context.workspace.programId, Math.min(Math.max(limit, 1), 300));
}
