import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = await getAuthenticatedUser(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const includeSpecialSources = request.nextUrl.searchParams.get('special') === '1';
    const apiSites = await getAvailableApiSites(authInfo.username, includeSpecialSources);

    return NextResponse.json({
      sources: apiSites.map((site) => ({
        key: site.key,
        name: site.name,
        api: site.api,
      })),
    });
  } catch (error) {
    logger.error('Failed to get available API sites:', error);
    return NextResponse.json(
      { error: 'Failed to load sources' },
      { status: 500 }
    );
  }
}
