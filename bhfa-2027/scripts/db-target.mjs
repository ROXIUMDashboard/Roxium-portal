/**
 * Decides whether a database connection string is a legitimate BHFA target.
 *
 * This exists because a connection string for the ROXIUM production project was
 * once handed to this tooling by mistake. Running BHFA's DDL there would have
 * added bhfa_* objects to an unrelated production database. Nothing in this
 * repository may connect to a database without passing through here first.
 *
 * Two independent checks, both of which must pass:
 *
 *   1. The project ref must not be a known ROXIUM / ELIXIR project.
 *   2. The caller must state the ref it believes it is targeting, in
 *      BHFA_DB_TARGET_REF, and it must match the connection string. A typo
 *      therefore fails closed rather than silently connecting somewhere else.
 */

/** Refs that must never be the target of BHFA tooling, at any time. */
export const FORBIDDEN_REFS = [
  'nchtmeqsjkpcvtuscxfy', // ROXIUM production (see scripts/lib/staging-guard.mjs)
];

/**
 * Supabase pooler usernames carry the project ref: postgres.<ref>. Direct
 * connections carry it in the host: db.<ref>.supabase.co.
 */
export function refFromConnectionString(connectionString) {
  const url = new URL(connectionString);
  const fromUser = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]{16,})$/i);
  if (fromUser) return fromUser[1];
  const fromHost = url.hostname.match(/^db\.([a-z0-9]{16,})\.supabase\.co$/i);
  if (fromHost) return fromHost[1];
  return null;
}

/**
 * Throws unless the string points at the BHFA project the caller named.
 * Returns the ref on success. Never logs the connection string.
 */
export function assertBhfaTarget(connectionString, expectedRef) {
  let ref;
  try {
    ref = refFromConnectionString(connectionString);
  } catch {
    throw new Error('REFUSED: SUPABASE_DB_URL is not a valid connection string.');
  }

  if (!ref) {
    throw new Error(
      'REFUSED: could not read a Supabase project ref from SUPABASE_DB_URL. ' +
        'Expected a pooler string (postgres.<ref>@…) or db.<ref>.supabase.co.',
    );
  }
  if (FORBIDDEN_REFS.includes(ref)) {
    throw new Error(
      `REFUSED: "${ref}" is a ROXIUM/ELIXIR project. BHFA tooling must never connect to it.`,
    );
  }
  if (!expectedRef) {
    throw new Error(
      'REFUSED: BHFA_DB_TARGET_REF is not set. State the project ref you intend to ' +
        'migrate so a mistyped connection string cannot connect somewhere unintended.',
    );
  }
  if (expectedRef.trim() !== ref) {
    throw new Error(
      `REFUSED: SUPABASE_DB_URL points at "${ref}" but BHFA_DB_TARGET_REF says "${expectedRef.trim()}".`,
    );
  }
  return ref;
}
