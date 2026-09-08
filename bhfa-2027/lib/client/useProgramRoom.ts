'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryEntry, PresenceEntry, ProgramSnapshot, Session } from '../domain/types';
import { sessionsForDay } from '../domain/schedule';
import { moveAcrossDays, moveWithinDay } from '../domain/ordering';
import { ApiError, createApi, type MutationResponse } from './api';
import { readClientId, readCollaboratorName, writeCollaboratorName } from './identity';

export type SaveState = 'idle' | 'saving' | 'saved' | 'reconnecting';

export interface Toast {
  id: string;
  message: string;
  /** Optional single action, used for Undo on high-impact changes. */
  action?: { label: string; run: () => void };
  tone: 'neutral' | 'alert';
}

export interface PendingShift {
  sessionId: string;
  dayId: string;
  deltaMinutes: number;
  message: string;
}

const TOAST_MS = 9000;
const PRESENCE_MS = 10_000;

function upsertSessions(current: Session[], incoming: Session[], deleted: string[]): Session[] {
  const removed = new Set(deleted);
  const byId = new Map(current.filter((s) => !removed.has(s.id)).map((s) => [s.id, s]));
  for (const session of incoming) {
    if (removed.has(session.id)) continue;
    byId.set(session.id, session);
  }
  return [...byId.values()];
}

export function useProgramRoom(token: string, initialSnapshot: ProgramSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [name, setName] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [activeDayId, setActiveDayId] = useState(initialSnapshot.days[0]?.id ?? '');
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [pendingShift, setPendingShift] = useState<PendingShift | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const inFlight = useRef(0);
  const identityRef = useRef({ name: 'Someone', clientId: '' });

  identityRef.current = { name: name ?? 'Someone', clientId };

  const api = useMemo(() => createApi(token, () => identityRef.current), [token]);

  /* ------------------------------------------------------------- identity */

  useEffect(() => {
    setClientId(readClientId());
    setName(readCollaboratorName());
  }, []);

  const enterProgram = useCallback((value: string) => {
    setName(writeCollaboratorName(value));
  }, []);

  /* --------------------------------------------------------------- toasts */

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-2), { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  /* ------------------------------------------------------------ mutations */

  const applyResponse = useCallback((response: MutationResponse) => {
    setSnapshot((current) => {
      const incoming = response.sessions ?? (response.session ? [response.session] : []);
      return {
        ...current,
        sessions: upsertSessions(current.sessions, incoming, response.deleted ?? []),
        revision: Math.max(current.revision, response.revision),
      };
    });
  }, []);

  /**
   * Run a mutation optimistically. The optimistic state stays on screen even if
   * the request fails for a transient reason — a surgeon's typing is never
   * thrown away because the network blinked.
   */
  const run = useCallback(
    async (
      optimistic: ((sessions: Session[]) => Session[]) | null,
      request: () => Promise<MutationResponse>,
      options: { toast?: Omit<Toast, 'id'>; onSuccess?: (response: MutationResponse) => void } = {},
    ): Promise<MutationResponse | null> => {
      if (optimistic) {
        setSnapshot((current) => ({ ...current, sessions: optimistic(current.sessions) }));
      }
      inFlight.current += 1;
      setSaveState('saving');
      try {
        const response = await request();
        applyResponse(response);
        options.onSuccess?.(response);
        if (options.toast) pushToast(options.toast);
        if (response.conflictWith) {
          pushToast({
            tone: 'neutral',
            message: `${response.conflictWith} had also edited this session. Both versions are kept in the change history.`,
          });
        }
        setLastSavedAt(Date.now());
        return response;
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        if (apiError?.retryable || apiError?.status === 0) {
          setSaveState('reconnecting');
          pushToast({ tone: 'neutral', message: apiError.message });
          return null;
        }
        // A rejected change (validation, or the row is gone) — resync so the
        // screen tells the truth, and say why in plain language.
        pushToast({ tone: 'alert', message: apiError?.message ?? 'That change could not be saved.' });
        try {
          setSnapshot(await api.snapshot());
        } catch {
          /* keep what is on screen */
        }
        return null;
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) {
          setSaveState((state) => (state === 'reconnecting' ? state : 'saved'));
        }
      }
    },
    [api, applyResponse, pushToast],
  );

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.snapshot();
      setSnapshot(fresh);
      setSaveState('saved');
    } catch {
      setSaveState('reconnecting');
    }
  }, [api]);

  /* ----------------------------------------------------------- collaborate */

  useEffect(() => {
    if (!name) return undefined;
    const source = new EventSource(api.streamUrl);

    const onMutation = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          actorClientId: string | null;
          revision: number;
          upserted: Session[];
          deleted: string[];
        };
        // Our own change has already been applied optimistically.
        if (payload.actorClientId && payload.actorClientId === identityRef.current.clientId) return;
        setSnapshot((current) => ({
          ...current,
          sessions: upsertSessions(current.sessions, payload.upserted ?? [], payload.deleted ?? []),
          revision: Math.max(current.revision, payload.revision),
        }));
      } catch {
        void refresh();
      }
    };

    const onPresence = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { entries: PresenceEntry[] };
        setPresence(payload.entries ?? []);
      } catch {
        /* ignore a malformed frame */
      }
    };

    source.addEventListener('mutation', onMutation as EventListener);
    source.addEventListener('presence', onPresence as EventListener);
    source.addEventListener('ready', ((event: MessageEvent) => {
      setSaveState((state) => (state === 'reconnecting' ? 'saved' : state));
      onPresence(event);
    }) as EventListener);
    source.onerror = () => setSaveState('reconnecting');

    return () => source.close();
  }, [api.streamUrl, name, refresh]);

  // Presence heartbeat: who is here, and which session they have open.
  useEffect(() => {
    if (!name || !clientId) return undefined;
    let cancelled = false;
    const beat = () => {
      if (cancelled) return;
      void api.presence({ clientId, sessionId: openSessionId, dayId: activeDayId }).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, PRESENCE_MS);
    const leave = () => {
      navigator.sendBeacon?.(
        `/api/program/${encodeURIComponent(token)}/presence`,
        new Blob([JSON.stringify({ clientId, leaving: true })], { type: 'application/json' }),
      );
    };
    window.addEventListener('pagehide', leave);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', leave);
    };
  }, [api, activeDayId, clientId, name, openSessionId, token]);

  /* -------------------------------------------------------------- actions */

  const sessionsByDay = useCallback(
    (dayId: string) => sessionsForDay(snapshot.sessions, dayId),
    [snapshot.sessions],
  );

  const undoAction = useCallback(
    (entry: HistoryEntry | null) =>
      entry
        ? {
            label: 'Undo',
            run: () => {
              void run(null, () => api.revert(entry.id, 'undo'));
            },
          }
        : undefined,
    [api, run],
  );

  const updateSession = useCallback(
    async (sessionId: string, patch: Record<string, unknown>) => {
      const optimistic = (sessions: Session[]) =>
        sessions.map((session) => (session.id === sessionId ? { ...session, ...(patch as Partial<Session>) } : session));
      return run(optimistic, () => api.updateSession(sessionId, patch));
    },
    [api, run],
  );

  const createSession = useCallback(
    async (input: Record<string, unknown>) => {
      const response = await run(null, () => api.createSession(input));
      if (response?.session) setOpenSessionId(response.session.id);
      return response;
    },
    [api, run],
  );

  const deleteSession = useCallback(
    async (session: Session) => {
      setOpenSessionId(null);
      const optimistic = (sessions: Session[]) => sessions.filter((s) => s.id !== session.id);
      return run(optimistic, () => api.deleteSession(session.id), {
        onSuccess: (response) =>
          pushToast({
            tone: 'neutral',
            message: `Deleted “${session.title || 'Untitled session'}”`,
            action: undoAction(response.history),
          }),
      });
    },
    [api, pushToast, run, undoAction],
  );

  const duplicateSession = useCallback(
    async (session: Session) =>
      createSession({
        dayId: session.dayId,
        afterSessionId: session.id,
        title: session.title ? `${session.title} (copy)` : '',
        description: session.description,
        startMinute: session.startMinute,
        endMinute: session.endMinute,
        sessionType: session.sessionType,
        sponsorName: session.sponsorName,
        room: session.room,
        internalNotes: session.internalNotes,
        speakers: session.speakers.map((s) => ({
          facultyId: s.facultyId,
          displayName: s.displayName,
          role: s.role,
          status: s.status,
        })),
      }),
    [createSession],
  );

  const reorder = useCallback(
    async (sessionId: string, targetDayId: string, targetIndex: number, options: { announce?: boolean } = {}) => {
      const session = snapshot.sessions.find((s) => s.id === sessionId);
      if (!session) return null;
      const sameDay = session.dayId === targetDayId;

      const assignments = sameDay
        ? moveWithinDay(sessionsByDay(session.dayId), sessionId, targetIndex)
        : moveAcrossDays(
            sessionsByDay(session.dayId),
            sessionsByDay(targetDayId),
            sessionId,
            targetDayId,
            targetIndex,
          );
      if (!assignments.length) return null;

      const byId = new Map(assignments.map((a) => [a.id, a]));
      const optimistic = (sessions: Session[]) =>
        sessions.map((s) => {
          const assignment = byId.get(s.id);
          return assignment ? { ...s, dayId: assignment.dayId, sortOrder: assignment.sortOrder } : s;
        });

      const targetDay = snapshot.days.find((d) => d.id === targetDayId);
      return run(optimistic, () => api.reorder(sessionId, targetDayId, targetIndex), {
        onSuccess: (response) => {
          if (sameDay && !options.announce) return;
          pushToast({
            tone: 'neutral',
            message: sameDay
              ? `Moved “${session.title || 'Untitled session'}”`
              : `“${session.title || 'Untitled session'}” moved to Day ${String(targetDay?.dayNumber ?? '').padStart(2, '0')}`,
            action: undoAction(response.history),
          });
        },
      });
    },
    [api, pushToast, run, sessionsByDay, snapshot.days, snapshot.sessions, undoAction],
  );

  const shiftFollowing = useCallback(
    async (dayId: string, afterSessionId: string, deltaMinutes: number) => {
      setPendingShift(null);
      return run(null, () => api.shift(dayId, afterSessionId, deltaMinutes), {
        onSuccess: (response) =>
          pushToast({
            tone: 'neutral',
            message: response.history?.summary ?? 'Following sessions shifted',
            action: undoAction(response.history),
          }),
      });
    },
    [api, pushToast, run, undoAction],
  );

  const loadHistory = useCallback(async () => {
    try {
      const { entries } = await api.history();
      setHistory(entries);
    } catch {
      pushToast({ tone: 'neutral', message: "Couldn't load the change history just now." });
    }
  }, [api, pushToast]);

  const revert = useCallback(
    async (entryId: string, mode: 'undo' | 'restore') => {
      const response = await run(null, () => api.revert(entryId, mode));
      if (response) {
        pushToast({ tone: 'neutral', message: response.history?.summary ?? 'Change reverted' });
        void loadHistory();
      }
      return response;
    },
    [api, loadHistory, pushToast, run],
  );

  const rotateLink = useCallback(async () => {
    try {
      return await api.rotate();
    } catch {
      pushToast({ tone: 'alert', message: "Couldn't rotate the link just now." });
      return null;
    }
  }, [api, pushToast]);

  /** Someone else with this session open, for the "Marc is editing" hint. */
  const editorsOf = useCallback(
    (sessionId: string) =>
      presence.filter((entry) => entry.sessionId === sessionId && entry.clientId !== clientId),
    [clientId, presence],
  );

  const collaborators = useMemo(
    () => presence.filter((entry) => entry.clientId !== clientId),
    [clientId, presence],
  );

  return {
    snapshot,
    name,
    clientId,
    enterProgram,
    activeDayId,
    setActiveDayId,
    openSessionId,
    setOpenSessionId,
    sessionsByDay,
    saveState,
    lastSavedAt,
    toasts,
    pushToast,
    dismissToast,
    pendingShift,
    setPendingShift,
    history,
    loadHistory,
    updateSession,
    createSession,
    deleteSession,
    duplicateSession,
    reorder,
    shiftFollowing,
    revert,
    rotateLink,
    refresh,
    editorsOf,
    collaborators,
  };
}

export type ProgramRoomState = ReturnType<typeof useProgramRoom>;
