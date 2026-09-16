/** @jest-environment node */
require('./web-globals');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const binary = process.env.PURETV_GO_TEST_BINARY;
const suite = binary ? describe : describe.skip;

suite('expanded worker with real isolated upstream and state', () => {
  let root, upstream, origin, child, workerURL;
  const token = 'expanded-integration-service-token-32';
  let originalEnv;
  let downloadCalls = 0;
  async function boot() {
    child = spawn(path.resolve(binary), [], {
      windowsHide: true,
      env: {
        ...process.env,
        PURETV_GO_TOKEN: token,
        PURETV_GO_LISTEN_ADDR: '127.0.0.1:0',
        PURETV_GO_OFFLINE_DOWNLOADS: 'false',
        PURETV_GO_LOCAL_FILES: 'true',
        PURETV_GO_TASKS: 'true',
        PURETV_GO_NETDISK_CHECK: 'true',
        PURETV_GO_ANIME_DOWNLOADS: 'true',
        PURETV_GO_STATE_DIR: path.join(root, 'state'),
        OFFLINE_DOWNLOAD_DIR: path.join(root, 'downloads'),
        PURETV_GO_ALLOWED_ORIGINS: JSON.stringify([origin]),
        OFFLINE_DOWNLOAD_PROXY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    workerURL = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error('worker start timeout')),
        10000,
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`worker exit ${code}`));
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
    process.env.PURETV_GO_URL = workerURL;
  }
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit');
      child.kill('SIGTERM');
      await done;
    }
  }
  beforeAll(async () => {
    originalEnv = process.env;
    process.env = {
      ...process.env,
      PURETV_GO_TOKEN: token,
      PURETV_GO_TASKS: 'true',
      PURETV_GO_SEARCH: 'true',
    };
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-expanded-'));
    const episode = path.join(root, 'downloads', 'source', 'video', 'ep1');
    fs.mkdirSync(episode, { recursive: true });
    fs.writeFileSync(path.join(episode, 'segment.ts'), '0123456789');
    fs.writeFileSync(
      path.join(episode, 'playlist.m3u8'),
      '#EXTM3U\n#EXTINF:1,\nsegment.ts\n',
    );
    upstream = http.createServer((req, res) => {
      if (req.url === '/epg.xml') {
        res.setHeader('Content-Type', 'application/xml');
        res.end(
          '<tv><channel id="c1"><display-name>CCTV</display-name></channel><programme channel="c1" start="20260914090000 +0800" stop="20260914100000 +0800"><title>新闻</title></programme></tv>',
        );
      } else if (req.url === '/live.m3u8') {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.end('#EXTM3U');
      } else if (req.url === '/comments') {
        res.end(
          '<i><d p="1,1,25,16777215,0,0,user,42">hello &amp; world</d></i>',
        );
      } else if (req.url === '/subscription') {
        res.end('{"api_site":{}}');
      } else if (req.url === '/api/auth/login') {
        res.end('{"code":200,"data":{"token":"fixture-token"}}');
      } else if (req.url === '/api/fs/list') {
        if (req.headers.authorization !== 'fixture-token') res.writeHead(401);
        res.end('{"code":200,"data":{"content":[],"total":0}}');
      } else if (req.url === '/api/fs/add_offline_download') {
        downloadCalls++;
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          if (body.includes('uncertain')) {
            res.writeHead(500);
            res.end('{"code":500}');
          } else res.end('{"code":200}');
        });
      } else if (req.url.startsWith('/cms?')) {
        res.end(
          '{"code":1,"page":1,"pagecount":1,"total":1,"list":[{"vod_id":1,"vod_name":"电影","vod_play_url":"正片$https://cdn.example/a.m3u8"}]}',
        );
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"results":[{"id":1}]}');
      }
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    origin = `http://127.0.0.1:${upstream.address().port}`;
    await boot();
  }, 20000);
  afterAll(async () => {
    await stop();
    if (upstream) {
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
    }
    process.env = originalEnv;
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
  const post = (route, body) =>
    fetch(workerURL + route, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  test('all extra internal routes reject anonymous requests', async () => {
    for (const route of [
      '/v1/local-files',
      '/v1/jobs',
      '/v1/cms',
      '/v1/live/precheck',
      '/v1/live/epg',
      '/v1/live/epg/download',
      '/v1/danmaku/comment',
      '/v1/metadata/fetch',
      '/v1/subscriptions/fetch',
      '/v1/openlist/operations',
      '/v1/netdisk/check/start',
      '/v1/netdisk/check/task',
      '/v1/netdisk/check/cancel',
      '/v1/anime/download',
      '/v1/anime/receipts/resolve',
    ]) {
      const response = await fetch(workerURL + route);
      expect(response.status).toBe(401);
      await response.body.cancel();
    }
  });
  test('Node bridge to native media, subscription, CMS and OpenList execution', async () => {
    const {
      requestGoMedia,
      parseGoEpg,
      fetchGoMetadata,
    } = require('../src/lib/server/go-media');
    expect(
      await (
        await requestGoMedia('/v1/live/precheck', {
          url: origin + '/live.m3u8',
        })
      ).json(),
    ).toEqual({ success: true, type: 'm3u8' });
    expect(
      (await parseGoEpg(origin + '/epg.xml', 'fixture', ['CCTV'])).CCTV[0],
    ).toEqual({
      start: '20260914090000 +0800',
      end: '20260914100000 +0800',
      title: '新闻',
    });
    expect(
      await (
        await requestGoMedia('/v1/danmaku/comment', {
          url: origin + '/comments',
        })
      ).json(),
    ).toMatchObject({
      count: 1,
      comments: [{ cid: 42, m: 'hello &amp; world' }],
    });
    expect(
      await (
        await requestGoMedia('/v1/subscriptions/fetch', {
          url: origin + '/subscription',
        })
      ).text(),
    ).toBe('{"api_site":{}}');
    expect(await (await fetchGoMetadata(origin + '/metadata')).json()).toEqual({
      results: [{ id: 1 }],
    });
    const { fetchCmsResponse } = require('../src/lib/server/go-cms');
    expect(
      await (
        await fetchCmsResponse(
          origin + '/cms?ac=videolist&wd=test&pg=1',
          {},
          8000,
          'search',
        )
      ).json(),
    ).toMatchObject({ list: [{ vod_name: '电影' }] });
    const { executeGoOpenList } = require('../src/lib/server/go-openlist');
    expect(
      await (
        await executeGoOpenList(
          origin,
          'user',
          'password',
          origin + '/api/fs/list',
          { method: 'POST', body: '{"path":"/"}' },
        )
      ).json(),
    ).toEqual({ code: 200, data: { content: [], total: 0 } });
  });
  test('real local-file bridge streams ranges and compatible playlist URLs', async () => {
    const { forwardLocalFile } = require('../src/lib/server/go-local-files');
    const { NextRequest } = require('next/server');
    const params = {
      source: 'source',
      videoId: 'video',
      episodeIndex: '0',
      file: 'segment.ts',
    };
    const response = await forwardLocalFile(
      new NextRequest('http://app.example/api/offline-download/local', {
        headers: { range: 'bytes=2-5' },
      }),
      params,
      'query',
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await response.text()).toBe('2345');
    const playlist = await forwardLocalFile(
      new NextRequest('http://app.example/api/offline-download/local'),
      { ...params, file: 'playlist.m3u8' },
      'path',
    );
    expect(await playlist.text()).toContain(
      '/api/offline-download/local/source/video/0/segment.ts',
    );
  });
  test('persistent lease remains queryable after worker process restart', async () => {
    const acquired = await (
      await post('/v1/jobs', {
        action: 'acquire',
        scope: 'openlist-refresh',
        payload: { progress: { current: 3, total: 9 } },
      })
    ).json();
    await stop();
    await boot();
    const visible = await (
      await post('/v1/jobs', { action: 'get', id: acquired.id })
    ).json();
    expect(visible.payload.progress.current).toBe(3);
    expect(visible.token).toBeUndefined();
    const completed = await post('/v1/jobs', {
      action: 'complete',
      id: acquired.id,
      token: acquired.token,
    });
    expect(completed.status).toBe(200);
    await completed.body.cancel();
  }, 20000);

  test('anime receipts survive restart and uncertain writes require explicit reconciliation', async () => {
    const input = {
      owner: 'fixture-owner',
      key: 'episode-1',
      operation: {
        url: origin,
        username: 'user',
        password: 'private-fixture',
        path: '/api/fs/add_offline_download',
        method: 'POST',
        body: JSON.stringify({
          path: '/Anime',
          urls: ['https://download.example/torrent'],
          tool: 'aria2',
        }),
        headers: { 'Content-Type': 'application/json' },
      },
    };
    expect(await (await post('/v1/anime/download', input)).json()).toEqual({
      code: 200,
      replayed: false,
    });
    expect(downloadCalls).toBe(1);
    await stop();
    await boot();
    expect(await (await post('/v1/anime/download', input)).json()).toEqual({
      code: 200,
      replayed: true,
    });
    expect(downloadCalls).toBe(1);
    const ambiguous = {
      ...input,
      key: 'episode-2',
      operation: {
        ...input.operation,
        body: JSON.stringify({
          path: '/Anime',
          urls: ['https://download.example/uncertain'],
          tool: 'aria2',
        }),
      },
    };
    const first = await post('/v1/anime/download', ambiguous);
    expect(first.status).toBe(409);
    const unknown = await first.json();
    expect(unknown.receiptId).toMatch(/^[a-f0-9]{64}$/);
    const second = await post('/v1/anime/download', ambiguous);
    expect(second.status).toBe(409);
    await second.body.cancel();
    expect(downloadCalls).toBe(2);
    const resolved = await post('/v1/anime/receipts/resolve', {
      receiptId: unknown.receiptId,
      action: 'confirm-succeeded',
    });
    expect(resolved.status).toBe(200);
    await resolved.body.cancel();
    expect(await (await post('/v1/anime/download', ambiguous)).json()).toEqual({
      code: 200,
      replayed: true,
    });
    expect(downloadCalls).toBe(2);
  }, 20000);
});
