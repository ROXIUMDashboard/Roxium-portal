import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { updateDay } from '@/lib/server/program-service';
import { parseDayPatch, requireId } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ token: string; dayId: string }> };

/** Edit a day's heading: navigation label, title, focus, weekday, date, hours. */
export async function PATCH(request: Request, { params }: Params) {
  const { token, dayId } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const result = await updateDay(auth.context, requireId(dayId, 'dayId'), parseDayPatch(body));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
