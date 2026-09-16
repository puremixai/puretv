import { NextRequest } from 'next/server';

import { getAvailableApiSites } from '@/lib/config';
import { searchJson, startSearch } from '@/lib/server/search-response';
import { listEnabledSourceScripts } from '@/lib/source-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await startSearch(request, 0);
  if (session instanceof Response) return session;
  try {
    const sites = await getAvailableApiSites(session.username);
    const scripts = (await listEnabledSourceScripts()).map((item) => ({
      key: item.key,
      name: item.name,
      script: true,
    }));
    return searchJson([...sites, ...scripts]);
  } catch {
    return searchJson({ error: '获取资源失败' }, 503);
  } finally {
    session.scope.dispose();
  }
}
