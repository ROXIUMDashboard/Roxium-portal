import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { deleteSession, updateSession } from '@/lib/server/program-service';
import { parseSessionPatch, requireId } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ token: string; sessionId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { token, sessionId } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const patch = parseSessionPatch(await readJson(request));
    const result = await updateSession(auth.context, requireId(sessionId, 'sessionId'), patch);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { token, sessionId } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const result = await deleteSession(auth.context, requireId(sessionId, 'sessionId'));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
