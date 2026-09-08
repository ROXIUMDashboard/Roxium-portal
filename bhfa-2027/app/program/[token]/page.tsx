import { notFound } from 'next/navigation';
import ProgramRoom from '@/components/ProgramRoom';
import { getRepository } from '@/lib/data';
import { getSnapshot, resolveWorkspace } from '@/lib/server/program-service';

export const dynamic = 'force-dynamic';

/**
 * The planning room. The collaboration token is validated on the server before
 * a single byte of programme content is rendered; an unknown or rotated token
 * is indistinguishable from a page that was never there.
 */
export default async function ProgramPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const workspace = await resolveWorkspace(token);
  if (!workspace) notFound();

  const snapshot = await getSnapshot({
    repository: getRepository(),
    workspace,
    actor: { name: 'Someone', clientId: null },
  });

  return <ProgramRoom token={token} initialSnapshot={snapshot} />;
}
