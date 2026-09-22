/**
 * Supabase (Postgres) driver. Runs only on the server: it is constructed with
 * the service-role key, which never leaves the Node process. Route handlers are
 * the sole callers.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Day, Faculty, HistoryEntry, ProgramSnapshot, Session, SessionSpeaker } from '../domain/types';
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function mapDay(row: Row): Day {
  return {
    id: row.id,
    programId: row.program_id,
    dayNumber: row.day_number,
    date: typeof row.date === 'string' ? row.date.slice(0, 10) : row.date,
    weekdayLabel: row.weekday_label ?? '',
    shortLabel: row.short_label ?? '',
    title: row.title,
    subtitle: row.subtitle ?? null,
    hoursLabel: row.hours_label ?? null,
    sortOrder: row.sort_order ?? 0,
  };
}

function mapSpeaker(row: Row): SessionSpeaker {
  return {
    id: row.id,
    facultyId: row.faculty_id ?? null,
    displayName: row.display_name ?? null,
    role: row.role ?? 'speaker',
    status: row.status ?? 'confirmed',
    sortOrder: row.sort_order ?? 0,
  };
}

function mapSession(row: Row): Session {
  const speakers: SessionSpeaker[] = (row.bhfa_session_speakers ?? [])
    .map(mapSpeaker)
    .sort((a: SessionSpeaker, b: SessionSpeaker) => a.sortOrder - b.sortOrder);
  return {
    id: row.id,
    dayId: row.day_id,
    sortOrder: row.sort_order ?? 0,
    title: row.title ?? '',
    description: row.description ?? null,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    sessionType: row.session_type,
    sponsorName: row.sponsor_name ?? null,
    sponsorLogoUrl: row.sponsor_logo_url ?? null,
    sponsorUrl: row.sponsor_url ?? null,
    room: row.room ?? null,
    status: row.status ?? 'draft',
    internalNotes: row.internal_notes ?? null,
    speakers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  };
}

function mapHistory(row: Row): HistoryEntry {
  return {
    id: row.id,
    programId: row.program_id,
    sessionId: row.session_id ?? null,
    dayId: row.day_id ?? null,
    actorName: row.actor_name ?? 'Someone',
    action: row.action,
    summary: row.summary ?? '',
    before: row.before ?? null,
    after: row.after ?? null,
    undone: Boolean(row.undone),
    createdAt: row.created_at,
  };
}

function sessionColumns(input: SessionPatch): Row {
  const row: Row = {};
  const map: Record<string, string> = {
    dayId: 'day_id',
    sortOrder: 'sort_order',
    title: 'title',
    description: 'description',
    startMinute: 'start_minute',
    endMinute: 'end_minute',
    sessionType: 'session_type',
    sponsorName: 'sponsor_name',
    sponsorLogoUrl: 'sponsor_logo_url',
    sponsorUrl: 'sponsor_url',
    room: 'room',
    status: 'status',
    internalNotes: 'internal_notes',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Row)[key];
    if (value !== undefined) row[column] = value;
  }
  return row;
}

export class SupabaseRepository implements ProgramRepository {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'bhfa-2027-program' } },
    });
  }

  /** Exposed so the realtime relay can reuse the same authenticated client. */
  get raw(): SupabaseClient {
    return this.client;
  }

  private fail(context: string, error: { message: string } | null): never {
    throw new Error(`${context}: ${error?.message ?? 'unknown error'}`);
  }

  async findWorkspaceByTokenHash(tokenHash: string): Promise<WorkspaceRecord | null> {
    const { data, error } = await this.client
      .from('bhfa_workspaces')
      .select('id, program_id, token_prefix, label, created_at, revoked_at')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) this.fail('Failed to resolve collaboration link', error);
    if (!data) return null;
    return {
      id: data.id,
      programId: data.program_id,
      tokenPrefix: data.token_prefix ?? '',
      label: data.label ?? '',
      createdAt: data.created_at,
      revokedAt: data.revoked_at ?? null,
    };
  }

  async rotateWorkspaceToken(workspaceId: string, tokenHash: string, tokenPrefix: string): Promise<WorkspaceRecord> {
    const { data, error } = await this.client
      .from('bhfa_workspaces')
      .update({ token_hash: tokenHash, token_prefix: tokenPrefix, created_at: new Date().toISOString() })
      .eq('id', workspaceId)
      .select('id, program_id, token_prefix, label, created_at, revoked_at')
      .single();
    if (error || !data) this.fail('Failed to rotate collaboration link', error);
    return {
      id: data.id,
      programId: data.program_id,
      tokenPrefix: data.token_prefix ?? '',
      label: data.label ?? '',
      createdAt: data.created_at,
      revokedAt: data.revoked_at ?? null,
    };
  }

  async getSnapshot(programId: string): Promise<ProgramSnapshot> {
    const [programResult, daysResult, facultyResult] = await Promise.all([
      this.client.from('bhfa_programs').select('*').eq('id', programId).single(),
      this.client.from('bhfa_days').select('*').eq('program_id', programId).order('sort_order'),
      this.client.from('bhfa_faculty').select('*').eq('program_id', programId).order('name'),
    ]);
    if (programResult.error || !programResult.data) this.fail('Failed to load program', programResult.error);
    if (daysResult.error) this.fail('Failed to load days', daysResult.error);
    if (facultyResult.error) this.fail('Failed to load faculty', facultyResult.error);

    const days = (daysResult.data ?? []).map(mapDay);
    const dayIds = days.map((d) => d.id);

    let sessions: Session[] = [];
    if (dayIds.length) {
      const { data, error } = await this.client
        .from('bhfa_sessions')
        .select('*, bhfa_session_speakers(*)')
        .in('day_id', dayIds)
        .order('sort_order');
      if (error) this.fail('Failed to load sessions', error);
      sessions = (data ?? []).map(mapSession);
    }

    const row = programResult.data;
    return {
      program: {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle ?? '',
        statusLabel: row.status_label ?? 'Working Program',
        locationLabel: row.location_label ?? '',
        dateRangeLabel: row.date_range_label ?? '',
      },
      days,
      sessions,
      faculty: (facultyResult.data ?? []).map((f: Row) => ({
        id: f.id,
        programId: f.program_id,
        name: f.name,
        credentials: f.credentials ?? null,
        headshotUrl: f.headshot_url ?? null,
      })),
      revision: Number(row.revision ?? 1),
    };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const { data, error } = await this.client
      .from('bhfa_sessions')
      .select('*, bhfa_session_speakers(*)')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) this.fail('Failed to load session', error);
    return data ? mapSession(data) : null;
  }

  private async replaceSpeakers(sessionId: string, speakers: SpeakerInput[]): Promise<void> {
    const { error: deleteError } = await this.client
      .from('bhfa_session_speakers')
      .delete()
      .eq('session_id', sessionId);
    if (deleteError) this.fail('Failed to update speakers', deleteError);
    if (!speakers.length) return;

    const rows = speakers.map((speaker, index) => ({
      session_id: sessionId,
      faculty_id: speaker.facultyId ?? null,
      display_name: speaker.displayName ?? null,
      role: speaker.role ?? 'speaker',
      status: speaker.status ?? 'confirmed',
      sort_order: index,
    }));
    const { error } = await this.client.from('bhfa_session_speakers').insert(rows);
    if (error) this.fail('Failed to save speakers', error);
  }

  async createSession(input: SessionInput, updatedBy: string): Promise<Session> {
    const row: Row = { ...sessionColumns(input), updated_by: updatedBy, updated_at: new Date().toISOString() };
    if (input.id) row.id = input.id;
    const { data, error } = await this.client.from('bhfa_sessions').insert(row).select('id').single();
    if (error || !data) this.fail('Failed to create session', error);
    if (input.speakers?.length) await this.replaceSpeakers(data.id, input.speakers);
    const created = await this.getSession(data.id);
    if (!created) this.fail('Failed to read back new session', null);
    return created;
  }

  async updateSession(sessionId: string, patch: SessionPatch, updatedBy: string): Promise<Session> {
    const columns = sessionColumns(patch);
    if (Object.keys(columns).length) {
      const { error } = await this.client
        .from('bhfa_sessions')
        .update({ ...columns, updated_by: updatedBy, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
      if (error) this.fail('Failed to save session', error);
    }
    if (patch.speakers !== undefined) await this.replaceSpeakers(sessionId, patch.speakers);
    const updated = await this.getSession(sessionId);
    if (!updated) throw new Error('Session not found');
    return updated;
  }

  async deleteSession(sessionId: string): Promise<Session | null> {
    const existing = await this.getSession(sessionId);
    if (!existing) return null;
    const { error } = await this.client.from('bhfa_sessions').delete().eq('id', sessionId);
    if (error) this.fail('Failed to delete session', error);
    return existing;
  }

  async applyOrder(assignments: OrderAssignment[], updatedBy: string): Promise<void> {
    if (!assignments.length) return;
    const now = new Date().toISOString();
    // Sequential single-row updates keep the change compatible with the
    // NOT NULL columns a bulk upsert would have to re-send.
    for (const assignment of assignments) {
      const { error } = await this.client
        .from('bhfa_sessions')
        .update({ day_id: assignment.dayId, sort_order: assignment.sortOrder, updated_by: updatedBy, updated_at: now })
        .eq('id', assignment.id);
      if (error) this.fail('Failed to save the new order', error);
    }
  }

  async applyTimes(assignments: TimeAssignment[], updatedBy: string): Promise<void> {
    if (!assignments.length) return;
    const now = new Date().toISOString();
    for (const assignment of assignments) {
      const { error } = await this.client
        .from('bhfa_sessions')
        .update({
          start_minute: assignment.startMinute,
          end_minute: assignment.endMinute,
          updated_by: updatedBy,
          updated_at: now,
        })
        .eq('id', assignment.id);
      if (error) this.fail('Failed to save the new times', error);
    }
  }

  async getDay(dayId: string): Promise<Day | null> {
    const { data, error } = await this.client.from('bhfa_days').select('*').eq('id', dayId).maybeSingle();
    if (error) this.fail('Failed to load day', error);
    return data ? mapDay(data) : null;
  }

  async updateDay(dayId: string, patch: DayPatch): Promise<Day> {
    const columns: Record<string, unknown> = {};
    if (patch.shortLabel !== undefined) columns.short_label = patch.shortLabel;
    if (patch.title !== undefined) columns.title = patch.title;
    if (patch.subtitle !== undefined) columns.subtitle = patch.subtitle;
    if (patch.weekdayLabel !== undefined) columns.weekday_label = patch.weekdayLabel;
    if (patch.date !== undefined) columns.date = patch.date;
    if (patch.hoursLabel !== undefined) columns.hours_label = patch.hoursLabel;

    if (Object.keys(columns).length) {
      const { error } = await this.client.from('bhfa_days').update(columns).eq('id', dayId);
      if (error) this.fail('Failed to save day', error);
    }
    const updated = await this.getDay(dayId);
    if (!updated) throw new Error('Day not found');
    return updated;
  }

  async listFaculty(programId: string): Promise<Faculty[]> {
    const { data, error } = await this.client.from('bhfa_faculty').select('*').eq('program_id', programId).order('name');
    if (error) this.fail('Failed to load faculty', error);
    return (data ?? []).map((f: Row) => ({
      id: f.id,
      programId: f.program_id,
      name: f.name,
      credentials: f.credentials ?? null,
      headshotUrl: f.headshot_url ?? null,
    }));
  }

  async upsertFacultyByName(programId: string, name: string): Promise<Faculty> {
    const { data: existing, error: findError } = await this.client
      .from('bhfa_faculty')
      .select('*')
      .eq('program_id', programId)
      .ilike('name', name)
      .maybeSingle();
    if (findError) this.fail('Failed to look up faculty', findError);
    if (existing) {
      return {
        id: existing.id,
        programId: existing.program_id,
        name: existing.name,
        credentials: existing.credentials ?? null,
        headshotUrl: existing.headshot_url ?? null,
      };
    }
    const { data, error } = await this.client
      .from('bhfa_faculty')
      .insert({ program_id: programId, name })
      .select('*')
      .single();
    if (error || !data) this.fail('Failed to add faculty', error);
    return {
      id: data.id,
      programId: data.program_id,
      name: data.name,
      credentials: data.credentials ?? null,
      headshotUrl: data.headshot_url ?? null,
    };
  }

  async addHistory(entry: HistoryInput): Promise<HistoryEntry> {
    const { data, error } = await this.client
      .from('bhfa_change_history')
      .insert({
        program_id: entry.programId,
        session_id: entry.sessionId ?? null,
        day_id: entry.dayId ?? null,
        actor_name: entry.actorName,
        action: entry.action,
        summary: entry.summary,
        before: entry.before ?? null,
        after: entry.after ?? null,
      })
      .select('*')
      .single();
    if (error || !data) this.fail('Failed to record history', error);
    return mapHistory(data);
  }

  async listHistory(programId: string, limit: number): Promise<HistoryEntry[]> {
    const { data, error } = await this.client
      .from('bhfa_change_history')
      .select('*')
      .eq('program_id', programId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) this.fail('Failed to load history', error);
    return (data ?? []).map(mapHistory);
  }

  async getHistoryEntry(entryId: string): Promise<HistoryEntry | null> {
    const { data, error } = await this.client.from('bhfa_change_history').select('*').eq('id', entryId).maybeSingle();
    if (error) this.fail('Failed to load history entry', error);
    return data ? mapHistory(data) : null;
  }

  async markHistoryUndone(entryId: string): Promise<void> {
    const { error } = await this.client.from('bhfa_change_history').update({ undone: true }).eq('id', entryId);
    if (error) this.fail('Failed to update history entry', error);
  }
}
