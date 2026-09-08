import { authorize } from '@/lib/server/http';
import { currentPresence, subscribe, type ProgramEvent } from '@/lib/server/realtime';

export const dynamic = 'force-dynamic';
/** Node runtime: the relay holds a long-lived Supabase Realtime subscription. */
export const runtime = 'nodejs';

const HEARTBEAT_MS = 20_000;

/**
 * Server-sent events. Browsers hold no Supabase credentials — the server
 * subscribes to Realtime on their behalf and relays what this workspace is
 * allowed to see, gated by the collaboration token in the URL.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authorize(request, token);
  if ('response' in auth) return auth.response;

  const programId = auth.context.workspace.programId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send('ready', { presence: currentPresence(programId) });

      const unsubscribe = subscribe(programId, (event: ProgramEvent) => send(event.type, event));
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
