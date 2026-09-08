import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { createSession } from '@/lib/server/program-service';
import { parseNewSession } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const input = parseNewSession(await readJson(request));
    const result = await createSession(auth.context, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
