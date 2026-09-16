import { NextRequest, NextResponse } from 'next/server';

import { bookProvider } from '@/lib/book-provider';

import { getAuthorizedBooksUsername } from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const sources = await bookProvider.getSources();
    return NextResponse.json({ sources });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
