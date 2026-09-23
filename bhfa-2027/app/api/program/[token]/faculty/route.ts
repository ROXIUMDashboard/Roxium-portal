import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { createFaculty } from '@/lib/server/program-service';
import { parseFacultyInput } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ token: string }> };

/** Add someone to the faculty register. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const result = await createFaculty(auth.context, parseFacultyInput(body));
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
