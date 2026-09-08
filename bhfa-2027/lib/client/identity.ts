'use client';

/**
 * Lightweight collaborator identity. This is NOT authentication — anyone with
 * the link may edit. The name exists so revision history and "who is editing"
 * are meaningful, and it never leaves the browser except as a header on the
 * collaborator's own requests.
 */
const NAME_KEY = 'bhfa.collaborator.name';
const CLIENT_KEY = 'bhfa.collaborator.id';

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Private browsing: identity simply lasts for this tab instead. */
  }
}

export function readCollaboratorName(): string | null {
  const stored = safeRead(NAME_KEY)?.trim();
  return stored ? stored : null;
}

export function writeCollaboratorName(name: string): string {
  const clean = name.trim().slice(0, 80);
  safeWrite(NAME_KEY, clean);
  return clean;
}

export function readClientId(): string {
  const existing = safeRead(CLIENT_KEY);
  if (existing) return existing;
  const created =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  safeWrite(CLIENT_KEY, created);
  return created;
}
