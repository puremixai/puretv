import { NextRequest, NextResponse } from 'next/server';

import { bookProvider } from '@/lib/book-provider';

import { getAuthorizedBooksUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId')?.trim();
    const href = searchParams.get('href')?.trim() || undefined;
    if (!sourceId) {
      return NextResponse.json({ error: '缺少 sourceId' }, { status: 400 });
    }
    const result = await bookProvider.getCatalog(sourceId, href);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
