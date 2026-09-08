import { NextResponse } from 'next/server';
import { authorize, handleError, NO_STORE } from '@/lib/server/http';
import { listHistory } from '@/lib/server/program-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token);
  if ('response' in auth) return auth.response;
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 120);
    const entries = await listHistory(auth.context, Number.isFinite(limit) ? limit : 120);
    return NextResponse.json({ entries }, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
