import { NextRequest } from 'next/server';

import { handleLiveProxy } from '@/lib/server/sensitive-proxy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handleLiveProxy(request, 'logo');
}
