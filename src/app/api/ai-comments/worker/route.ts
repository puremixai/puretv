import { NextRequest, NextResponse } from 'next/server';

import { runAICommentJob } from '@/lib/server/ai-comments';

import { isAICommentWorkerToken } from '../../../../../server/ai-comment-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isAICommentWorkerToken(request.headers.get('x-ai-worker-token'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ processed: await runAICommentJob() });
}
