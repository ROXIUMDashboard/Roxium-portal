import { NextResponse } from 'next/server';
import { authorize, handleError, NO_STORE } from '@/lib/server/http';
import { generateToken, hashToken, tokenPrefix } from '@/lib/server/tokens';

export const dynamic = 'force-dynamic';

/**
 * Rotate the collaboration link. The old link stops working immediately; the
 * new one is returned once and is never stored in plain text anywhere.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const next = generateToken();
    await auth.context.repository.rotateWorkspaceToken(
      auth.context.workspace.id,
      hashToken(next),
      tokenPrefix(next),
    );
    await auth.context.repository.addHistory({
      programId: auth.context.workspace.programId,
      actorName: auth.context.actor.name,
      action: 'details_changed',
      summary: 'Rotated the collaboration link',
    });
    return NextResponse.json({ token: next, path: `/program/${next}` }, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
