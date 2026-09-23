/**
 * Persistence boundary. Two drivers implement this interface:
 *
 *   supabase — production (Postgres + Realtime, service-role key, server only)
 *   memory   — local demo and automated tests (in-process, no credentials)
 *
 * Everything above this line (route handlers, the program service, the UI) is
 * driver-agnostic, which is what lets the full collaboration workflow be
 * exercised in tests without a live database.
 */
import type {
  Day,
  Faculty,
  FacultyRegion,
  FacultyStatus,
  HistoryAction,
  HistoryEntry,
  ProgramSnapshot,
  Session,
  SessionStatus,
  SessionType,
  SpeakerRole,
  SpeakerStatus,
} from '../domain/types';

export interface WorkspaceRecord {
  id: string;
  programId: string;
  tokenPrefix: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface SpeakerInput {
  facultyId?: string | null;
  displayName?: string | null;
  role?: SpeakerRole;
  status?: SpeakerStatus;
}

export interface SessionInput {
  dayId: string;
  sortOrder: number;
  title: string;
  description?: string | null;
  startMinute: number;
  endMinute: number;
  sessionType?: SessionType;
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  sponsorUrl?: string | null;
  room?: string | null;
  status?: SessionStatus;
  internalNotes?: string | null;
  speakers?: SpeakerInput[];
  updatedBy?: string | null;
  /** Only used when restoring a deleted session, to keep its original id. */
  id?: string;
}

export type SessionPatch = Partial<Omit<SessionInput, 'id'>>;

export interface OrderAssignment {
  id: string;
  dayId: string;
  sortOrder: number;
}

export interface TimeAssignment {
  id: string;
  startMinute: number;
  endMinute: number;
}

export interface HistoryInput {
  programId: string;
  sessionId?: string | null;
  dayId?: string | null;
  facultyId?: string | null;
  actorName: string;
  action: HistoryAction;
  summary: string;
  before?: unknown;
  after?: unknown;
}

/** The editable presentation fields of a programme day. */
export interface DayPatch {
  shortLabel?: string;
  title?: string;
  subtitle?: string | null;
  weekdayLabel?: string;
  date?: string;
  hoursLabel?: string | null;
}

/** Every editable faculty field. Absent keys are left as they are. */
export interface FacultyPatch {
  name?: string;
  credentials?: string | null;
  headshotUrl?: string | null;
  status?: FacultyStatus | null;
  region?: FacultyRegion | null;
  city?: string | null;
  stateProvince?: string | null;
  country?: string | null;
  specialty?: string | null;
  proposedRole?: string | null;
  invitationStatus?: string | null;
  invitationDate?: string | null;
  lastContactDate?: string | null;
  owner?: string | null;
  priority?: boolean;
  internalNotes?: string | null;
  email?: string | null;
  phone?: string | null;
  institution?: string | null;
  website?: string | null;
}

export interface FacultyInput extends FacultyPatch {
  /** Supplied only when restoring a deleted record from history. */
  id?: string;
  name: string;
}

export interface ProgramRepository {
  /** Constant-time-ish token lookup by hash. Returns null for unknown/revoked. */
  findWorkspaceByTokenHash(tokenHash: string): Promise<WorkspaceRecord | null>;
  rotateWorkspaceToken(workspaceId: string, tokenHash: string, tokenPrefix: string): Promise<WorkspaceRecord>;

  getSnapshot(programId: string): Promise<ProgramSnapshot>;
  getSession(sessionId: string): Promise<Session | null>;

  createSession(input: SessionInput, updatedBy: string): Promise<Session>;
  updateSession(sessionId: string, patch: SessionPatch, updatedBy: string): Promise<Session>;
  deleteSession(sessionId: string): Promise<Session | null>;

  applyOrder(assignments: OrderAssignment[], updatedBy: string): Promise<void>;
  applyTimes(assignments: TimeAssignment[], updatedBy: string): Promise<void>;

  getDay(dayId: string): Promise<Day | null>;
  updateDay(dayId: string, patch: DayPatch): Promise<Day>;

  listFaculty(programId: string): Promise<Faculty[]>;
  upsertFacultyByName(programId: string, name: string): Promise<Faculty>;
  getFaculty(facultyId: string): Promise<Faculty | null>;
  createFaculty(programId: string, input: FacultyInput, updatedBy: string): Promise<Faculty>;
  updateFaculty(facultyId: string, patch: FacultyPatch, updatedBy: string): Promise<Faculty>;
  deleteFaculty(facultyId: string): Promise<Faculty | null>;
  /** Session-speaker rows pointing at this person — deleting them would orphan these. */
  countFacultyAssignments(facultyId: string): Promise<number>;

  addHistory(entry: HistoryInput): Promise<HistoryEntry>;
  listHistory(programId: string, limit: number): Promise<HistoryEntry[]>;
  getHistoryEntry(entryId: string): Promise<HistoryEntry | null>;
  markHistoryUndone(entryId: string): Promise<void>;
}
