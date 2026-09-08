/**
 * Driver selection. `supabase` is used whenever credentials are present;
 * otherwise the app falls back to the in-memory driver so `npm run dev` and the
 * test suite work with no configuration at all.
 */
import 'server-only';
import type { ProgramRepository } from './repository';
import { MemoryRepository } from './memory';
import { SupabaseRepository } from './supabase';
import { generateToken, hashToken, tokenPrefix } from '../server/tokens';
import { describeCredentials, readSupabaseCredentials } from '../server/supabase-env';

export type DriverName = 'supabase' | 'memory';

interface RepositoryHandle {
  repository: ProgramRepository;
  driver: DriverName;
  /** Only set for the memory driver, and only ever logged server-side. */
  devToken?: string;
}

/**
 * Next.js compiles server components and route handlers into separate module
 * graphs, so a plain module-level singleton would be instantiated twice — the
 * page would read one in-memory program while the API mutated another. Pinning
 * the handle to globalThis keeps one instance per process. (With the Supabase
 * driver both graphs talk to the same database, so this only matters for the
 * memory driver — but sharing the client is worth it either way.)
 */
const HANDLE_KEY = Symbol.for('bhfa.program.repository');
type GlobalWithHandle = typeof globalThis & { [HANDLE_KEY]?: RepositoryHandle };
const globalRef = globalThis as GlobalWithHandle;

function resolveDriver(): DriverName {
  const explicit = process.env.PROGRAM_DATA_DRIVER?.toLowerCase();
  if (explicit === 'memory') return 'memory';
  if (explicit === 'supabase') return 'supabase';
  return process.env.SUPABASE_URL ? 'supabase' : 'memory';
}

export function getRepositoryHandle(): RepositoryHandle {
  const existing = globalRef[HANDLE_KEY];
  if (existing) return existing;

  const driver = resolveDriver();
  if (driver === 'supabase') {
    const credentials = readSupabaseCredentials();
    if (process.env.NODE_ENV !== 'test') {
      console.info(`  BHFA 2027 · Supabase ${describeCredentials(credentials)}`);
    }
    const supabaseHandle = {
      repository: new SupabaseRepository(credentials.url, credentials.key),
      driver,
    };
    globalRef[HANDLE_KEY] = supabaseHandle;
    return supabaseHandle;
  }

  const devToken = process.env.SEED_COLLAB_TOKEN || generateToken();
  const memoryHandle: RepositoryHandle = {
    repository: new MemoryRepository(hashToken(devToken), tokenPrefix(devToken)),
    driver,
    devToken,
  };
  globalRef[HANDLE_KEY] = memoryHandle;

  if (process.env.NODE_ENV !== 'test') {
    console.info(
      `\n  BHFA 2027 · in-memory driver (no database configured).\n  Collaboration link: /program/${devToken}\n`,
    );
  }
  return memoryHandle;
}

export function getRepository(): ProgramRepository {
  return getRepositoryHandle().repository;
}

export function getDriverName(): DriverName {
  return getRepositoryHandle().driver;
}

/** Test-only: rebuild the in-memory programme between test files. */
export function resetRepositoryForTests(token: string): void {
  const current = getRepositoryHandle();
  if (current.repository instanceof MemoryRepository) {
    current.repository.reset(hashToken(token), tokenPrefix(token));
    current.devToken = token;
  }
}
