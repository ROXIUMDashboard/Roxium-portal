import { NextResponse } from 'next/server';
import { authorize, handleError, readJson, NO_STORE } from '@/lib/server/http';
import { deleteFaculty, updateFaculty } from '@/lib/server/program-service';
import { parseFacultyPatch, requireId } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ token: string; facultyId: string }> };

/** Edit a faculty member: status, region, details, planning notes. */
export async function PATCH(request: Request, { params }: Params) {
  const { token, facultyId } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const result = await updateFaculty(auth.context, requireId(facultyId, 'facultyId'), parseFacultyPatch(body));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}

/** Remove someone from the register. Refused while they are on the agenda. */
export async function DELETE(request: Request, { params }: Params) {
  const { token, facultyId } = await params;
  const auth = await authorize(request, token, { mutation: true });
  if ('response' in auth) return auth.response;
  try {
    const result = await deleteFaculty(auth.context, requireId(facultyId, 'facultyId'));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return handleError(error);
  }
}
