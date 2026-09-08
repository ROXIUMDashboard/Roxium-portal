import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { revertHistoryEntry } from '@/lib/server/program-service';
import { requireId } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; entryId: string }> },
) {
  const { token, entryId } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const mode = body.mode === 'restore' ? 'restore' : 'undo';
    const result = await revertHistoryEntry(auth.context, requireId(entryId, 'entryId'), mode);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
