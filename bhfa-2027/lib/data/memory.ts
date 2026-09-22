/**
 * In-process driver. Used for local demos and for the automated test suite, so
 * the entire collaboration workflow (including realtime fan-out and revision
 * history) can be exercised without a database.
 *
 * It is never selected when SUPABASE_URL is configured.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { Day, Faculty, HistoryEntry, Program, ProgramSnapshot, Session, SessionSpeaker } from '../domain/types';
import { SEED_DAYS, SEED_FACULTY, SEED_PROGRAM } from '../seed/program-2027';
import type {
  DayPatch,
  HistoryInput,
  OrderAssignment,
  ProgramRepository,
  SessionInput,
  SessionPatch,
  SpeakerInput,
  TimeAssignment,
  WorkspaceRecord,
} from './repository';

interface MemoryState {
  program: Program & { revision: number };
  workspaces: WorkspaceRecord[];
  tokenHashes: Map<string, string>; // workspaceId -> hash
  days: Day[];
  faculty: Faculty[];
  sessions: Session[];
  history: HistoryEntry[];
}

/** Deterministic ids so a restart of the dev server keeps the same links. */
function stableId(...parts: string[]): string {
  const hex = createHash('sha1').update(['bhfa-2027', ...parts].join('|')).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`, `a${hex.slice(17, 20)}`, hex.slice(20, 32)].join('-');
}

function buildState(seedTokenHash: string, seedTokenPrefix: string): MemoryState {
  const programId = stableId('program');
  const now = new Date().toISOString();

  const days: Day[] = SEED_DAYS.map((day, index) => ({
    id: stableId('day', day.key),
    programId,
    dayNumber: day.dayNumber,
    date: day.date,
    weekdayLabel: day.weekdayLabel,
    shortLabel: day.shortLabel,
    title: day.title,
    subtitle: day.subtitle,
    hoursLabel: day.hoursLabel,
    sortOrder: index,
  }));

  const faculty: Faculty[] = SEED_FACULTY.map((f) => ({
    id: stableId('faculty', f.key),
    programId,
    name: f.name,
    credentials: f.credentials,
    headshotUrl: null,
  }));

  const sessions: Session[] = [];
  SEED_DAYS.forEach((day, dayIndex) => {
    day.sessions.forEach((seed, index) => {
      const id = stableId('session', seed.key);
      sessions.push({
        id,
        dayId: days[dayIndex].id,
        sortOrder: index,
        title: seed.title,
        description: seed.description,
        startMinute: seed.startMinute,
        endMinute: seed.endMinute,
        sessionType: seed.sessionType,
        sponsorName: null,
        sponsorLogoUrl: null,
        sponsorUrl: null,
        room: null,
        status: 'draft',
        internalNotes: null,
        speakers: (seed.speakers ?? []).map((speaker, speakerIndex) => ({
          id: stableId('speaker', seed.key, String(speakerIndex)),
          facultyId: speaker.name ? (faculty.find((f) => f.name === speaker.name)?.id ?? null) : null,
          displayName: null,
          role: speaker.role ?? 'speaker',
          status: speaker.status ?? 'confirmed',
          sortOrder: speakerIndex,
        })),
        createdAt: now,
        updatedAt: now,
        updatedBy: null,
      });
    });
  });

  const workspaceId = stableId('workspace');
  return {
    program: {
      id: programId,
      title: SEED_PROGRAM.title,
      subtitle: SEED_PROGRAM.subtitle,
      statusLabel: SEED_PROGRAM.statusLabel,
      locationLabel: SEED_PROGRAM.locationLabel,
      dateRangeLabel: SEED_PROGRAM.dateRangeLabel,
      revision: 1,
    },
    workspaces: [
      {
        id: workspaceId,
        programId,
        tokenPrefix: seedTokenPrefix,
        label: 'Primary collaboration link',
        createdAt: now,
        revokedAt: null,
      },
    ],
    tokenHashes: new Map([[workspaceId, seedTokenHash]]),
    days,
    faculty,
    sessions,
    history: [],
  };
}

export class MemoryRepository implements ProgramRepository {
  private state: MemoryState;

  constructor(seedTokenHash: string, seedTokenPrefix: string) {
    this.state = buildState(seedTokenHash, seedTokenPrefix);
  }

  /** Test helper: return to the pristine seeded programme. */
  reset(seedTokenHash: string, seedTokenPrefix: string) {
    this.state = buildState(seedTokenHash, seedTokenPrefix);
  }

  get programId(): string {
    return this.state.program.id;
  }

  private bump() {
    this.state.program.revision += 1;
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  async findWorkspaceByTokenHash(tokenHash: string): Promise<WorkspaceRecord | null> {
    for (const workspace of this.state.workspaces) {
      if (workspace.revokedAt) continue;
      if (this.state.tokenHashes.get(workspace.id) === tokenHash) return this.clone(workspace);
    }
    return null;
  }

  async rotateWorkspaceToken(workspaceId: string, tokenHash: string, tokenPrefix: string): Promise<WorkspaceRecord> {
    const workspace = this.state.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    workspace.tokenPrefix = tokenPrefix;
    workspace.createdAt = new Date().toISOString();
    this.state.tokenHashes.set(workspaceId, tokenHash);
    return this.clone(workspace);
  }

  async getSnapshot(programId: string): Promise<ProgramSnapshot> {
    if (programId !== this.state.program.id) throw new Error('Unknown program');
    const { revision, ...program } = this.state.program;
    return this.clone({
      program,
      days: this.state.days,
      sessions: this.state.sessions,
      faculty: this.state.faculty,
      revision,
    });
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const session = this.state.sessions.find((s) => s.id === sessionId);
    return session ? this.clone(session) : null;
  }

  private materialiseSpeakers(sessionId: string, speakers: SpeakerInput[]): SessionSpeaker[] {
    return speakers.map((speaker, index) => ({
      id: randomUUID(),
      facultyId: speaker.facultyId ?? null,
      displayName: speaker.displayName ?? null,
      role: speaker.role ?? 'speaker',
      status: speaker.status ?? 'confirmed',
      sortOrder: index,
    }));
  }

  async createSession(input: SessionInput, updatedBy: string): Promise<Session> {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const session: Session = {
      id,
      dayId: input.dayId,
      sortOrder: input.sortOrder,
      title: input.title,
      description: input.description ?? null,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      sessionType: input.sessionType ?? 'scientific_session',
      sponsorName: input.sponsorName ?? null,
      sponsorLogoUrl: input.sponsorLogoUrl ?? null,
      sponsorUrl: input.sponsorUrl ?? null,
      room: input.room ?? null,
      status: input.status ?? 'draft',
      internalNotes: input.internalNotes ?? null,
      speakers: this.materialiseSpeakers(id, input.speakers ?? []),
      createdAt: now,
      updatedAt: now,
      updatedBy,
    };
    this.state.sessions.push(session);
    this.bump();
    return this.clone(session);
  }

  async updateSession(sessionId: string, patch: SessionPatch, updatedBy: string): Promise<Session> {
    const session = this.state.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('Session not found');

    const assignable: (keyof SessionPatch)[] = [
      'dayId', 'sortOrder', 'title', 'description', 'startMinute', 'endMinute', 'sessionType',
      'sponsorName', 'sponsorLogoUrl', 'sponsorUrl', 'room', 'status', 'internalNotes',
    ];
    for (const key of assignable) {
      if (patch[key] !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any)[key] = patch[key];
      }
    }
    if (patch.speakers !== undefined) {
      session.speakers = this.materialiseSpeakers(sessionId, patch.speakers);
    }
    session.updatedAt = new Date().toISOString();
    session.updatedBy = updatedBy;
    this.bump();
    return this.clone(session);
  }

  async deleteSession(sessionId: string): Promise<Session | null> {
    const index = this.state.sessions.findIndex((s) => s.id === sessionId);
    if (index === -1) return null;
    const [removed] = this.state.sessions.splice(index, 1);
    this.bump();
    return this.clone(removed);
  }

  async applyOrder(assignments: OrderAssignment[], updatedBy: string): Promise<void> {
    const now = new Date().toISOString();
    for (const assignment of assignments) {
      const session = this.state.sessions.find((s) => s.id === assignment.id);
      if (!session) continue;
      session.dayId = assignment.dayId;
      session.sortOrder = assignment.sortOrder;
      session.updatedAt = now;
      session.updatedBy = updatedBy;
    }
    if (assignments.length) this.bump();
  }

  async applyTimes(assignments: TimeAssignment[], updatedBy: string): Promise<void> {
    const now = new Date().toISOString();
    for (const assignment of assignments) {
      const session = this.state.sessions.find((s) => s.id === assignment.id);
      if (!session) continue;
      session.startMinute = assignment.startMinute;
      session.endMinute = assignment.endMinute;
      session.updatedAt = now;
      session.updatedBy = updatedBy;
    }
    if (assignments.length) this.bump();
  }

  async getDay(dayId: string): Promise<Day | null> {
    const day = this.state.days.find((d) => d.id === dayId);
    return day ? this.clone(day) : null;
  }

  async updateDay(dayId: string, patch: DayPatch): Promise<Day> {
    const day = this.state.days.find((d) => d.id === dayId);
    if (!day) throw new Error('Day not found');
    if (patch.shortLabel !== undefined) day.shortLabel = patch.shortLabel;
    if (patch.title !== undefined) day.title = patch.title;
    if (patch.subtitle !== undefined) day.subtitle = patch.subtitle;
    if (patch.weekdayLabel !== undefined) day.weekdayLabel = patch.weekdayLabel;
    if (patch.date !== undefined) day.date = patch.date;
    if (patch.hoursLabel !== undefined) day.hoursLabel = patch.hoursLabel;
    return this.clone(day);
  }

  async listFaculty(programId: string): Promise<Faculty[]> {
    return this.clone(this.state.faculty.filter((f) => f.programId === programId));
  }

  async upsertFacultyByName(programId: string, name: string): Promise<Faculty> {
    const existing = this.state.faculty.find(
      (f) => f.programId === programId && f.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return this.clone(existing);
    const created: Faculty = { id: randomUUID(), programId, name, credentials: null, headshotUrl: null };
    this.state.faculty.push(created);
    return this.clone(created);
  }

  async addHistory(entry: HistoryInput): Promise<HistoryEntry> {
    const record: HistoryEntry = {
      id: randomUUID(),
      programId: entry.programId,
      sessionId: entry.sessionId ?? null,
      dayId: entry.dayId ?? null,
      actorName: entry.actorName,
      action: entry.action,
      summary: entry.summary,
      before: entry.before ?? null,
      after: entry.after ?? null,
      undone: false,
      createdAt: new Date().toISOString(),
    };
    this.state.history.unshift(record);
    return this.clone(record);
  }

  async listHistory(programId: string, limit: number): Promise<HistoryEntry[]> {
    return this.clone(this.state.history.filter((h) => h.programId === programId).slice(0, limit));
  }

  async getHistoryEntry(entryId: string): Promise<HistoryEntry | null> {
    const entry = this.state.history.find((h) => h.id === entryId);
    return entry ? this.clone(entry) : null;
  }

  async markHistoryUndone(entryId: string): Promise<void> {
    const entry = this.state.history.find((h) => h.id === entryId);
    if (entry) entry.undone = true;
  }
}
