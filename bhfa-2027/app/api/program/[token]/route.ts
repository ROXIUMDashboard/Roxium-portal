import { NextResponse } from 'next/server';
import { authorize, handleError, NO_STORE } from '@/lib/server/http';
import { getSnapshot } from '@/lib/server/program-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token);
  if ('response' in auth) return auth.response;
  try {
    const snapshot = await getSnapshot(auth.context);
    return NextResponse.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
