import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { reorderSession } from '@/lib/server/program-service';
import { requireId, ValidationError } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const targetIndex = Number(body.targetIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0) {
      throw new ValidationError('That drop position is not valid.');
    }
    const result = await reorderSession(auth.context, {
      sessionId: requireId(body.sessionId, 'sessionId'),
      targetDayId: requireId(body.targetDayId, 'targetDayId'),
      targetIndex,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
