/**
 * The guard that stands between BHFA tooling and somebody else's database.
 *
 * A ROXIUM production connection string was once handed to this tooling by
 * mistake. These cases exist so that can never silently succeed.
 */
import { describe, expect, it } from 'vitest';
import { assertBhfaTarget, refFromConnectionString, FORBIDDEN_REFS } from '@/scripts/db-target.mjs';

const BHFA = 'bhfanewprojectref123';
const ROXIUM_PRODUCTION = 'nchtmeqsjkpcvtuscxfy';

const pooler = (ref: string) =>
  `postgresql://postgres.${ref}:secret@aws-1-us-west-2.pooler.supabase.com:5432/postgres`;
const direct = (ref: string) => `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres`;

describe('reading the project ref', () => {
  it('reads it from a pooler username', () => {
    expect(refFromConnectionString(pooler(BHFA))).toBe(BHFA);
  });

  it('reads it from a direct host', () => {
    expect(refFromConnectionString(direct(BHFA))).toBe(BHFA);
  });

  it('returns null when there is no ref to read', () => {
    expect(refFromConnectionString('postgresql://postgres:secret@localhost:5432/postgres')).toBeNull();
  });
});

describe('assertBhfaTarget', () => {
  it('accepts a BHFA project the caller named', () => {
    expect(assertBhfaTarget(pooler(BHFA), BHFA)).toBe(BHFA);
  });

  it('refuses ROXIUM production even when the caller names it', () => {
    // The exact mistake this guard was written for.
    expect(FORBIDDEN_REFS).toContain(ROXIUM_PRODUCTION);
    expect(() => assertBhfaTarget(pooler(ROXIUM_PRODUCTION), ROXIUM_PRODUCTION)).toThrow(/ROXIUM/i);
  });

  it('refuses when the caller has not said which project it expects', () => {
    expect(() => assertBhfaTarget(pooler(BHFA), undefined)).toThrow(/BHFA_DB_TARGET_REF/);
  });

  it('refuses when the string and the stated ref disagree', () => {
    expect(() => assertBhfaTarget(pooler(BHFA), 'someotherprojectref1')).toThrow(/points at/);
  });

  it('refuses a string with no recognisable ref', () => {
    expect(() => assertBhfaTarget('postgresql://postgres:secret@localhost:5432/postgres', BHFA)).toThrow(
      /could not read a Supabase project ref/,
    );
  });

  it('never puts the connection string in the error', () => {
    try {
      assertBhfaTarget(pooler(ROXIUM_PRODUCTION), ROXIUM_PRODUCTION);
      throw new Error('should have refused');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret');
    }
  });
});
