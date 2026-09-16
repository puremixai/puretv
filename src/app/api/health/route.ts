import { NextResponse } from 'next/server';

import { getHealth } from '../../../../server/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The Lite image runs Next's standalone server, without the custom server route.
export async function GET() {
  const health = await getHealth();
  return NextResponse.json(health, {
    status: health.status === 'unavailable' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
