'use client';

/**
 * The browser's only channel to the data. Every call carries the collaborator's
 * display name and client id as headers; the collaboration token stays in the
 * URL path and is validated server-side on every request.
 *
 * Transient failures (offline, 5xx) are surfaced as `retryable` so the caller
 * can keep the surgeon's change on screen and try again rather than dropping it.
 */
import type { Day, Faculty, HistoryEntry, ProgramSnapshot, Session } from '../domain/types';

/** Reported when a save landed on top of a version another collaborator wrote. */
export interface EditConflict {
  actorName: string;
  at: string;
  fields: { label: string; theirs: string; yours: string }[];
  latest: Session;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface MutationResponse {
  session?: Session;
  sessions?: Session[];
  deleted?: string[];
  revision: number;
  history: HistoryEntry | null;
  conflict?: EditConflict | null;
  /** Present when the change may have added a name to the faculty roster. */
  faculty?: Faculty[];
  /** Present when a day heading may have changed. */
  days?: Day[];
  /** The faculty member a faculty mutation created, changed or removed. */
  facultyMember?: Faculty;
}

export interface ApiIdentity {
  name: string;
  clientId: string;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

async function request<T>(
  path: string,
  identity: ApiIdentity,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-collaborator-name': encodeURIComponent(identity.name),
        'x-collaborator-id': identity.clientId,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      "Couldn't reach the program just now. We'll keep your change here while reconnecting.",
      0,
      true,
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body?.error === 'string' ? body.error : 'That change could not be saved.';
    throw new ApiError(message, response.status, RETRYABLE_STATUSES.has(response.status));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function createApi(token: string, getIdentity: () => ApiIdentity) {
  const base = `/api/program/${encodeURIComponent(token)}`;
  const call = <T,>(path: string, init?: RequestInit) => request<T>(`${base}${path}`, getIdentity(), init);

  return {
    snapshot: () => call<ProgramSnapshot>(''),

    createSession: (input: Record<string, unknown>) =>
      call<MutationResponse>('/sessions', { method: 'POST', body: JSON.stringify(input) }),

    updateSession: (sessionId: string, patch: Record<string, unknown>, baseUpdatedAt?: string | null) =>
      call<MutationResponse>(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(baseUpdatedAt ? { ...patch, baseUpdatedAt } : patch),
      }),

    updateDay: (dayId: string, patch: Record<string, unknown>) =>
      call<MutationResponse>(`/days/${dayId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

    createFaculty: (input: Record<string, unknown>) =>
      call<MutationResponse>('/faculty', { method: 'POST', body: JSON.stringify(input) }),

    updateFaculty: (facultyId: string, patch: Record<string, unknown>) =>
      call<MutationResponse>(`/faculty/${facultyId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

    deleteFaculty: (facultyId: string) =>
      call<MutationResponse>(`/faculty/${facultyId}`, { method: 'DELETE' }),

    deleteSession: (sessionId: string) =>
      call<MutationResponse>(`/sessions/${sessionId}`, { method: 'DELETE' }),

    reorder: (sessionId: string, targetDayId: string, targetIndex: number) =>
      call<MutationResponse>('/reorder', {
        method: 'POST',
        body: JSON.stringify({ sessionId, targetDayId, targetIndex }),
      }),

    shift: (dayId: string, afterSessionId: string, deltaMinutes: number) =>
      call<MutationResponse>('/shift', {
        method: 'POST',
        body: JSON.stringify({ dayId, afterSessionId, deltaMinutes }),
      }),

    history: () => call<{ entries: HistoryEntry[] }>('/history'),

    revert: (entryId: string, mode: 'undo' | 'restore') =>
      call<MutationResponse>(`/history/${entryId}/revert`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }),

    presence: (payload: Record<string, unknown>) =>
      call<{ entries: unknown[] }>('/presence', { method: 'POST', body: JSON.stringify(payload) }),

    rotate: () => call<{ token: string; path: string }>('/rotate', { method: 'POST' }),

    streamUrl: `${base}/stream`,
  };
}

export type ProgramApi = ReturnType<typeof createApi>;
