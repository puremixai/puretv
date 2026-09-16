/** @jest-environment node */
require('./web-globals');
jest.mock('../src/lib/server/go-worker', () => ({
  isGoWorkerEnabled: jest.fn(),
  requestWorker: jest.fn(),
}));
const {
  isGoWorkerEnabled,
  requestWorker,
} = require('../src/lib/server/go-worker');
const { acquireGoJob, readGoJob } = require('../src/lib/server/go-jobs');
beforeEach(() => {
  jest.clearAllMocks();
  isGoWorkerEnabled.mockReturnValue(true);
  requestWorker.mockImplementation(async () =>
    Response.json({
      id: 'job-1',
      token: 'private-lease',
      status: 'running',
      started: 1,
      updated: 1,
      expires: 120001,
    }),
  );
});
test('default mode never contacts worker', async () => {
  isGoWorkerEnabled.mockReturnValue(false);
  expect(await acquireGoJob('cron')).toBeUndefined();
  expect(requestWorker).not.toHaveBeenCalled();
});
test('lease updates preserve progress and finish uses secret only internally', async () => {
  const lease = await acquireGoJob('openlist-refresh');
  await lease.renew({ progress: { current: 1, total: 2 } });
  await lease.finish(true, { status: 'completed' });
  const bodies = requestWorker.mock.calls.map(([, init]) =>
    JSON.parse(init.body),
  );
  expect(bodies.map((b) => b.action)).toEqual(['acquire', 'renew', 'complete']);
  expect(bodies[1]).toMatchObject({
    id: 'job-1',
    token: 'private-lease',
    payload: { progress: { current: 1, total: 2 } },
  });
  expect(() => lease.assertActive()).toThrow();
});
test('failed renewal prevents further execution and never reacquires', async () => {
  const lease = await acquireGoJob('cron');
  requestWorker.mockRejectedValue(new Error('network secret'));
  await expect(lease.renew()).rejects.toThrow('Go 任务服务不可用');
  expect(() => lease.assertActive()).toThrow();
  expect(requestWorker).toHaveBeenCalledTimes(2);
  await expect(lease.finish(false)).rejects.toThrow();
});
test('busy and not-found keep meaningful statuses', async () => {
  requestWorker.mockResolvedValue(
    Response.json({ error: 'busy', remainingSeconds: 40 }, { status: 409 }),
  );
  await expect(acquireGoJob('cron')).rejects.toMatchObject({
    status: 409,
    remainingSeconds: 40,
  });
  requestWorker.mockResolvedValue(
    Response.json({ error: 'missing' }, { status: 404 }),
  );
  expect(await readGoJob('missing')).toBeNull();
});

test('a blocked event loop cannot keep a lease valid beyond its deadline', async () => {
  const clock = jest.spyOn(performance, 'now').mockReturnValue(1000);
  let lease;
  try {
    lease = await acquireGoJob('cron');
    clock.mockReturnValue(121001);
    expect(() => lease.assertActive()).toThrow();
    await expect(lease.renew()).rejects.toThrow();
    expect(requestWorker).toHaveBeenCalledTimes(1);
  } finally {
    await lease?.finish(false);
    clock.mockRestore();
  }
});
