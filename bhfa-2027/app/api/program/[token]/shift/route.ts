import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { shiftFollowingSessions } from '@/lib/server/program-service';
import { requireId, ValidationError } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

/** Maximum bulk move in one action: four hours in either direction. */
const MAX_SHIFT = 240;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const deltaMinutes = Number(body.deltaMinutes);
    if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0 || Math.abs(deltaMinutes) > MAX_SHIFT) {
      throw new ValidationError('That shift is outside the range we can apply in one step.');
    }
    const result = await shiftFollowingSessions(auth.context, {
      dayId: requireId(body.dayId, 'dayId'),
      afterSessionId: requireId(body.afterSessionId, 'afterSessionId'),
      deltaMinutes,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
