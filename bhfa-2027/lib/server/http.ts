/**
 * Route-handler plumbing: token authorisation, actor identity, rate limiting,
 * and error responses written in language a surgeon would accept on screen.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { getRepository } from '../data';
import { resolveWorkspace, NotFoundError, type ProgramContext } from './program-service';
import { ValidationError } from './validate';
import { cleanActorName, cleanText } from './validate';
import { rateLimit } from './rate-limit';

export const ACTOR_HEADER = 'x-collaborator-name';
export const CLIENT_HEADER = 'x-collaborator-id';

/** Deliberately identical for "no such link" and "revoked link". */
function unknownLink(): NextResponse {
  return NextResponse.json(
    { error: 'This collaboration link is not valid. Ask a program chair to resend it.' },
    { status: 404 },
  );
}

/** Names travel percent-encoded so any character is a legal header value. */
function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

export interface AuthorizeOptions {
  /** Mutations are rate limited more tightly than reads. */
  mutation?: boolean;
}

export async function authorize(
  request: Request,
  token: string,
  options: AuthorizeOptions = {},
): Promise<{ context: ProgramContext } | { response: NextResponse }> {
  const limit = options.mutation
    ? rateLimit(`mutate:${clientKey(request)}`, 240, 60_000)
    : rateLimit(`read:${clientKey(request)}`, 600, 60_000);

  if (!limit.allowed) {
    return {
      response: NextResponse.json(
        { error: 'That was a lot of changes at once. Give it a few seconds and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      ),
    };
  }

  const workspace = await resolveWorkspace(token);
  if (!workspace) return { response: unknownLink() };

  return {
    context: {
      repository: getRepository(),
      workspace,
      actor: {
        name: cleanActorName(decodeHeader(request.headers.get(ACTOR_HEADER))),
        clientId: cleanText(request.headers.get(CLIENT_HEADER), 64),
      },
    },
  };
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error('[bhfa] mutation failed', error);
  return NextResponse.json(
    { error: "We couldn't save that just now. Your change is still here — we'll retry in a moment." },
    { status: 503 },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('That request was not readable.');
  }
}

/** Nothing in this app may be cached or indexed. */
export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;
