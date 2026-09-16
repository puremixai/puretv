import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { requireFeaturePermission } from '@/lib/permissions';
import { getScanTask } from '@/lib/scan-task';
import { readGoJob } from '@/lib/server/go-jobs';
import { isGoWorkerEnabled } from '@/lib/server/go-worker';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/scan-progress?taskId=xxx
 * 获取扫描任务进度
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(
      request,
      'private_library',
      '无权限访问私人影库',
    );
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
    }

    let task = getScanTask(taskId);
    if (isGoWorkerEnabled('tasks')) {
      const job = await readGoJob(taskId);
      if (!job || !job.payload || typeof job.payload !== 'object') {
        task = null;
      } else {
        task = {
          ...(job.payload as NonNullable<typeof task>),
          id: job.id,
          status: job.status,
        };
        if (job.status === 'failed' && !task.error)
          task.error = '扫描已中断，请重新发起刷新';
      }
    }

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      task,
    });
  } catch (error) {
    logger.error('获取扫描进度失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
