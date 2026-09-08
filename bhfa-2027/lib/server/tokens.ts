import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Collaboration tokens. 32 random bytes (256 bits) rendered base64url — long
 * enough that guessing is not a threat model, and unguessable by construction
 * (never sequential, never derived from a program id).
 *
 * Only the SHA-256 hash is stored. An optional pepper from the environment is
 * mixed in so a leaked database dump alone does not yield working links.
 */
export const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  const pepper = process.env.COLLAB_TOKEN_PEPPER ?? '';
  return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 6);
}

/** Cheap shape check so obviously malformed tokens never reach the database. */
export function isPlausibleToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** Constant-time comparison of two hex digests. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
