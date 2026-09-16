import { isGoWorkerEnabled, requestWorker } from './go-worker';
import { readLimitedText } from './media-body';

interface WorkerJob {
  id: string;
  token?: string;
  status: 'running' | 'completed' | 'failed';
  started: number;
  updated: number;
  expires: number;
  payload?: unknown;
}

export class GoJobError extends Error {
  constructor(
    readonly status: number,
    readonly remainingSeconds = 0,
  ) {
    super(status === 409 ? '任务正在运行或租约已失效' : 'Go 任务服务不可用');
  }
}

async function call(input: Record<string, unknown>): Promise<WorkerJob> {
  let response: Response;
  try {
    response = await requestWorker(
      '/v1/jobs',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      10_000,
    );
    const value = JSON.parse(await readLimitedText(response, 128 * 1024));
    if (!response.ok)
      throw new GoJobError(response.status, value.remainingSeconds);
    if (
      !value ||
      typeof value.id !== 'string' ||
      typeof value.status !== 'string'
    ) {
      throw new GoJobError(503);
    }
    return value as WorkerJob;
  } catch (error) {
    if (error instanceof GoJobError) throw error;
    throw new GoJobError(503);
  }
}

export class GoJobLease {
  readonly id: string;
  private readonly token: string;
  private timer: ReturnType<typeof setInterval>;
  private pending: Promise<unknown> = Promise.resolve();
  private failed = false;
  private stopped = false;
  private validUntil: number;

  constructor(job: WorkerJob, requestedAt: number) {
    if (!job.token) throw new GoJobError(503);
    this.id = job.id;
    this.token = job.token;
    this.validUntil = requestedAt + this.leaseBudget(job);
    this.timer = setInterval(() => {
      void this.renew().catch(() => undefined);
    }, 20_000);
    this.timer.unref?.();
  }

  assertActive(): void {
    if (this.failed || this.stopped || performance.now() >= this.validUntil)
      throw new GoJobError(409);
  }

  private leaseBudget(job: WorkerJob): number {
    const duration = job.expires - job.updated;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120_000)
      throw new GoJobError(503);
    return duration;
  }

  async renew(payload?: unknown): Promise<void> {
    this.assertActive();
    const operation = this.pending.then(async () => {
      this.assertActive();
      const requestedAt = performance.now();
      const job = await call({
        action: 'renew',
        id: this.id,
        token: this.token,
        payload,
      });
      this.validUntil = requestedAt + this.leaseBudget(job);
      this.assertActive();
    });
    this.pending = operation.catch(() => {
      this.failed = true;
      clearInterval(this.timer);
    });
    await operation;
  }

  async finish(success: boolean, payload?: unknown): Promise<void> {
    clearInterval(this.timer);
    await this.pending;
    if (this.stopped) return;
    if (success) this.assertActive();
    this.stopped = true;
    await call({
      action: success ? 'complete' : 'fail',
      id: this.id,
      token: this.token,
      payload,
    });
  }
}

export async function acquireGoJob(
  scope: 'openlist-refresh' | 'cron' | 'anime-subscriptions',
  cooldown = 0,
): Promise<GoJobLease | undefined> {
  if (!isGoWorkerEnabled('tasks')) return undefined;
  const requestedAt = performance.now();
  return new GoJobLease(
    await call({ action: 'acquire', scope, cooldown }),
    requestedAt,
  );
}

export async function readGoJob(id: string): Promise<WorkerJob | null> {
  try {
    return await call({ action: 'get', id });
  } catch (error) {
    if (error instanceof GoJobError && error.status === 404) return null;
    throw error;
  }
}
