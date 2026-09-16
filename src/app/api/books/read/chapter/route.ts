import { NextRequest, NextResponse } from 'next/server';

import { legadoClient } from '@/lib/legado.client';

import { getAuthorizedBooksUsername } from '../../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId')?.trim();
    const href = searchParams.get('href')?.trim();
    const tocHref = searchParams.get('tocHref')?.trim() || undefined;
    if (!sourceId || !href) return NextResponse.json({ error: '缺少 sourceId 或 href' }, { status: 400 });
    const chapter = await legadoClient.getChapterContent(sourceId, href, tocHref);
    return NextResponse.json(chapter);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
