/** @jest-environment node */
// Opt-in: PURETV_GO_TEST_BINARY points to a locally built worker. No user services/data are used.
require('./web-globals');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/session', () => ({
  getAuthenticatedUser: jest.fn(async () => ({
    username: 'owner',
    role: 'owner',
  })),
}));

const binary = process.env.PURETV_GO_TEST_BINARY;
const suite = binary ? describe : describe.skip;
suite('real Node → Go → fixture compatibility', () => {
  let root, upstream, origin, worker, workerURL, routes, local, bridge;
  const token = 'isolated-worker-test-token-32-characters';
  const children = new Set();
  async function startWorker(downloads, directory) {
    const child = spawn(path.resolve(binary), [], {
      windowsHide: true,
      env: {
        ...process.env,
        PURETV_GO_TOKEN: token,
        PURETV_GO_LISTEN_ADDR: '127.0.0.1:0',
        PURETV_GO_OFFLINE_DOWNLOADS: String(downloads),
        OFFLINE_DOWNLOAD_DIR: directory,
        PURETV_GO_ALLOWED_ORIGINS: JSON.stringify([origin]),
        OFFLINE_DOWNLOAD_PROXY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let output = '';
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('worker startup timed out')),
        10000,
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`worker startup exit ${code}: ${output}`));
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.stdout.on('data', (data) => {
        output += data;
        const match = output.match(/"address":"([^"]+)"/);
        if (match) {
          clearTimeout(timer);
          resolve(`http://${match[1]}`);
        }
      });
    });
    return { child, url };
  }
  async function stop(child) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    children.delete(child);
  }
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-go-integration-'));
    upstream = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/auth/login') {
        res.end(
          JSON.stringify({
            code: 200,
            data: { token: 'fixture-openlist-token' },
          }),
        );
      } else if (req.url === '/api/fs/list') {
        if (req.headers.authorization !== 'fixture-openlist-token') {
          res.writeHead(401);
          res.end();
          return;
        }
        res.end(
          JSON.stringify({
            code: 200,
            data: {
              content: [
                {
                  name: 'Film 2024',
                  is_dir: true,
                  size: 0,
                  custom: 'preserved',
                },
              ],
            },
          }),
        );
      } else if (req.url === '/master.m3u8?sig=a%2Fb') {
        res.end(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360\nmedia.m3u8?sig=a%2Fb\n',
        );
      } else if (req.url === '/media.m3u8?sig=a%2Fb') {
        res.end(
          '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="key?sig=a%2Fb",IV=0x01\n#EXTINF:4,\nseg.ts?sig=a%2Fb\n#EXT-X-ENDLIST\n',
        );
      } else if (req.url === '/key?sig=a%2Fb') {
        res.end('0123456789abcdef');
      } else if (req.url === '/seg.ts?sig=a%2Fb') {
        res.end('fixture-segment-bytes');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    origin = `http://127.0.0.1:${upstream.address().port}`;
    const started = await startWorker(true, root);
    worker = started.child;
    workerURL = started.url;
    jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'test',
      NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD: 'true',
      OFFLINE_DOWNLOAD_DIR: root,
      PURETV_GO_URL: workerURL,
      PURETV_GO_TOKEN: token,
      PURETV_GO_OFFLINE_DOWNLOADS: 'true',
    });
    jest.resetModules();
    routes = require('../src/app/api/offline-download/route');
    local = require('../src/app/api/offline-download/local/route');
    bridge = require('../src/lib/server/go-worker');
  }, 15000);
  afterAll(async () => {
    await Promise.all([...children].map(stop));
    if (upstream) {
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
    }
    jest.restoreAllMocks();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
  const request = (method, suffix = '', body) =>
    new NextRequest(`http://puretv.test/api/offline-download${suffix}`, {
      method,
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          }
        : {}),
    });
  test('health is public and internal operations require the worker token', async () => {
    expect((await fetch(`${workerURL}/readyz`)).status).toBe(200);
    expect((await fetch(`${workerURL}/v1/offline-download`)).status).toBe(401);
  });
  test('existing download API completes HLS, existing local API plays files, retry/delete preserve identity', async () => {
    const created = await routes.POST(
      request('POST', '', {
        source: 'fixture',
        videoId: 'one',
        episodeIndex: 0,
        title: 'Example',
        m3u8Url: `${origin}/master.m3u8?sig=a%2Fb`,
        metadata: { videoTitle: 'Example', year: '2024' },
      }),
    );
    expect(created.status).toBe(200);
    const { task } = await created.json();
    async function completed() {
      for (let i = 0; i < 100; i++) {
        const { tasks } = await (await routes.GET(request('GET'))).json();
        if (tasks[0]?.status === 'completed') return tasks[0];
        if (tasks[0]?.status === 'error')
          throw new Error(tasks[0].errorMessage);
        await delay(25);
      }
      throw new Error('download did not complete');
    }
    expect(await completed()).toMatchObject({
      id: task.id,
      progress: 100,
      downloadedSegments: 1,
      metadata: { videoTitle: 'Example' },
    });
    const check = '?action=check&source=fixture&videoId=one&episodeIndex=0';
    expect(await (await routes.GET(request('GET', check))).json()).toEqual({
      downloaded: true,
    });
    const mediaQuery = '/local?source=fixture&videoId=one&episodeIndex=0&file=';
    const playlist = await (
      await local.GET(request('GET', mediaQuery + 'playlist.m3u8'))
    ).text();
    expect(playlist).toContain(
      '/api/offline-download/local?source=fixture&videoId=one&episodeIndex=0&file=segment_00000.ts',
    );
    expect(playlist).toContain('file=key.key');
    expect(
      await (
        await local.GET(request('GET', mediaQuery + 'segment_00000.ts'))
      ).text(),
    ).toBe('fixture-segment-bytes');
    expect(
      await (await local.GET(request('GET', mediaQuery + 'key.key'))).text(),
    ).toBe('0123456789abcdef');
    expect(
      (await routes.PUT(request('PUT', `?taskId=${task.id}&action=retry`)))
        .status,
    ).toBe(200);
    expect((await completed()).id).toBe(task.id);
    expect(
      (await routes.DELETE(request('DELETE', `?taskId=${task.id}`))).status,
    ).toBe(200);
    expect(await (await routes.GET(request('GET', check))).json()).toEqual({
      downloaded: false,
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'tasks.json'), 'utf8')),
    ).toEqual([]);
  }, 15000);
  test('Node OpenList bridge reaches native login and directory enumeration', async () => {
    const result = await bridge.scanGoOpenListRoots({
      url: origin,
      username: 'fixture',
      password: 'fixture',
      rootPaths: ['/Movies'],
    });
    expect(result).toEqual({
      groups: [
        {
          rootPath: '/Movies',
          folders: [
            { name: 'Film 2024', is_dir: true, size: 0, custom: 'preserved' },
          ],
        },
      ],
      errors: [],
    });
  });
  test('scan-only worker never opens or locks an existing downloader volume', async () => {
    const started = await startWorker(false, root); // First worker still holds this directory's lock.
    expect((await fetch(`${started.url}/readyz`)).status).toBe(200);
    expect(
      (
        await fetch(`${started.url}/v1/offline-download`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(503);
    await stop(started.child);
  }, 15000);
});
