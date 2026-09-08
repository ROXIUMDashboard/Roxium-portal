/**
 * Realtime fan-out.
 *
 * Browsers never hold a Supabase key. Instead each browser opens an SSE stream
 * to this server (authenticated by the collaboration token), and the server
 * relays two things onto it:
 *
 *   1. mutations applied on this instance, published locally, and
 *   2. mutations applied on *other* instances, received over a Supabase
 *      Realtime broadcast channel that only the server subscribes to.
 *
 * That keeps the deployment horizontally scalable on Railway while the
 * service-role key stays inside the Node process.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { PresenceEntry, Session } from '../domain/types';
import { getRepositoryHandle } from '../data';
import { SupabaseRepository } from '../data/supabase';

export interface MutationEvent {
  type: 'mutation';
  revision: number;
  origin: string;
  /** Browser client id that caused the change, so it can ignore its own echo. */
  actorClientId: string | null;
  actorName: string;
  summary: string;
  upserted: Session[];
  deleted: string[];
}

export interface PresenceEvent {
  type: 'presence';
  origin: string;
  entries: PresenceEntry[];
}

export type ProgramEvent = MutationEvent | PresenceEvent;

type Listener = (event: ProgramEvent) => void;

/** Identifies this server process so it can ignore its own broadcast echo. */
export const INSTANCE_ID = randomUUID();

const listeners = new Map<string, Set<Listener>>();
const presence = new Map<string, Map<string, PresenceEntry>>();
const channels = new Map<string, RealtimeChannel>();

/** Collaborators are considered gone this long after their last heartbeat. */
export const PRESENCE_TTL_MS = 25_000;

export function subscribe(programId: string, listener: Listener): () => void {
  const set = listeners.get(programId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(programId, set);
  ensureChannel(programId);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(programId);
  };
}

function emitLocal(programId: string, event: ProgramEvent): void {
  const set = listeners.get(programId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // A broken stream must never take down a mutation.
    }
  }
}

/** Lazily join the cross-instance broadcast channel (Supabase driver only). */
function ensureChannel(programId: string): RealtimeChannel | null {
  const existing = channels.get(programId);
  if (existing) return existing;

  const handle = getRepositoryHandle();
  if (!(handle.repository instanceof SupabaseRepository)) return null;

  const channel = handle.repository.raw.channel(`bhfa:${programId}`, {
    config: { broadcast: { self: false } },
  });
  channel.on('broadcast', { event: 'program' }, (message) => {
    const event = message.payload as ProgramEvent | undefined;
    if (!event || event.origin === INSTANCE_ID) return;
    if (event.type === 'presence') mergeRemotePresence(programId, event.entries);
    emitLocal(programId, event);
  });
  channel.subscribe();
  channels.set(programId, channel);
  return channel;
}

export function publish(programId: string, event: ProgramEvent): void {
  emitLocal(programId, event);
  const channel = ensureChannel(programId);
  if (channel) {
    void channel.send({ type: 'broadcast', event: 'program', payload: event }).catch(() => {
      // Realtime is a convenience; a failed broadcast must not fail the write.
    });
  }
}

/* ------------------------------------------------------------------ presence */

function bucket(programId: string): Map<string, PresenceEntry> {
  const existing = presence.get(programId);
  if (existing) return existing;
  const created = new Map<string, PresenceEntry>();
  presence.set(programId, created);
  return created;
}

function prune(programId: string): PresenceEntry[] {
  const now = Date.now();
  const map = bucket(programId);
  for (const [clientId, entry] of map) {
    if (now - entry.updatedAt > PRESENCE_TTL_MS) map.delete(clientId);
  }
  return [...map.values()];
}

function mergeRemotePresence(programId: string, entries: PresenceEntry[]): void {
  const map = bucket(programId);
  for (const entry of entries) map.set(entry.clientId, entry);
  prune(programId);
}

export function recordPresence(programId: string, entry: Omit<PresenceEntry, 'updatedAt'>): PresenceEntry[] {
  const map = bucket(programId);
  map.set(entry.clientId, { ...entry, updatedAt: Date.now() });
  const entries = prune(programId);
  publish(programId, { type: 'presence', origin: INSTANCE_ID, entries });
  return entries;
}

export function dropPresence(programId: string, clientId: string): void {
  bucket(programId).delete(clientId);
  publish(programId, { type: 'presence', origin: INSTANCE_ID, entries: prune(programId) });
}

export function currentPresence(programId: string): PresenceEntry[] {
  return prune(programId);
}
