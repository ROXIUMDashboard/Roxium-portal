import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { currentPresence, dropPresence, recordPresence } from '@/lib/server/realtime';
import { cleanText, requireId, ValidationError } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

/** Heartbeat carrying "who I am and which session I have open". */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const clientId = cleanText(body.clientId, 64);
    if (!clientId) throw new ValidationError('Missing collaborator id.');

    if (body.leaving) {
      dropPresence(auth.context.workspace.programId, clientId);
      return NextResponse.json({ entries: currentPresence(auth.context.workspace.programId) }, { headers: NO_STORE });
    }

    const entries = recordPresence(auth.context.workspace.programId, {
      clientId,
      name: auth.context.actor.name,
      sessionId: body.sessionId ? requireId(body.sessionId, 'sessionId') : null,
      dayId: body.dayId ? requireId(body.dayId, 'dayId') : null,
    });
    return NextResponse.json({ entries }, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
