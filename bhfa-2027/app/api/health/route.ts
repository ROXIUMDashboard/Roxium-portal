import { NextResponse } from 'next/server';
import { getDriverName } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** Railway health check. Reports readiness without leaking configuration. */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', driver: getDriverName(), time: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
