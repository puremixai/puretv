// Integration smoke for revisions, permissions and Fake-IP media access.
// Runs only against its own disposable SQLite database and container.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const bs58 = require('bs58').default;
const name = 'puretv-optimization-qa-' + randomBytes(4).toString('hex');
const username = 'optimization-owner';
const password = 'temporary-optimization-test-password';
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', ...options }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let origin = '', cookie = '', version = 0, keep = false;
async function request(path, body, headers = {}) {
  return fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-config-version': String(version), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
}
async function config() { const response = await request('/api/admin/config'); assert.equal(response.status, 200); const data = await response.json(); version = data.Config.ConfigVersion || 0; return data.Config; }
async function login(user = username) {
  const response = await request('/api/login', { username: user, password }); assert.equal(response.status, 200, 'login ' + user);
  return response.headers.getSetCookie().find(value => value.startsWith('auth=')).split(';')[0];
}
(async () => {
  try {
    docker(['run','-d','--name',name,'--init','-p','127.0.0.1::3000','-e','PASSWORD','-e','AUTH_SECRET','-e','CRON_SECRET','-e',`USERNAME=${username}`,'-e',`ADMIN_USERNAME=${username}`,'-e','NEXT_PUBLIC_STORAGE_TYPE=d1','-e','SQLITE_DB_PATH=/tmp/optimization.db','-e','HOSTNAME=0.0.0.0','-e','PORT=3000',process.env.SMOKE_IMAGE || 'puretv:optimization-candidate'], { env: { ...process.env, PASSWORD: password, AUTH_SECRET: randomBytes(32).toString('hex'), CRON_SECRET: randomBytes(32).toString('hex') } });
    origin = 'http://' + docker(['port',name,'3000/tcp']).split('\n')[0];
    let ready = false;
    for (let i = 0; i < 120; i++) { try { if ((await fetch(origin + '/login', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {} await delay(500); }
    assert.ok(ready, 'QA server started'); await delay(4000);
    cookie = await login(); const initial = await config(); const base = version;
    assert.equal((await request('/api/admin/config', { SiteConfig: { AnalyticsCustomScript: 'forbidden' } })).status, 400);
    const results = await Promise.all([request('/api/admin/config', { LiveRefreshIntervalHours: 11 }), request('/api/admin/config', { LiveRefreshIntervalHours: 12 })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200,409], 'one winner for parallel writes');
    await config(); assert.equal(version, base + 1);
    const history = await (await request('/api/admin/config/history')).json(); assert.ok(history.history.some(item => item.version === base));
    assert.equal((await request('/api/admin/config/history', { version: base }, { 'x-config-version': String(base) })).status, 409, 'stale rollback denied');
    assert.equal((await request('/api/admin/config/history', { version: base })).status, 200);
    const restored = await config(); assert.equal(restored.LiveRefreshIntervalHours, initial.LiveRefreshIntervalHours); assert.equal(version, base + 2);
    console.log('PASS: database CAS, history retention, restore and stale rollback');
    assert.equal((await request('/api/admin/user', { action: 'add', targetUsername: 'must-not-exist', targetPassword: password }, { 'x-config-version': '' })).status, 428);
    const count = docker(['exec',name,'node','-e',"const db=require('better-sqlite3')('/tmp/optimization.db');console.log(db.prepare('SELECT count(*) AS n FROM users WHERE username = ?').get('must-not-exist').n)"]);
    assert.equal(count, '0', 'missing revision cannot create a user before failing');
    assert.equal((await request('/api/admin/user', { action: 'add', targetUsername: 'qa-admin', targetPassword: password })).status, 200); await config();
    assert.equal((await request('/api/admin/user', { action: 'setAdmin', targetUsername: 'qa-admin' })).status, 200); await config();
    const ownerCookie = cookie; cookie = await login('qa-admin'); await config();
    assert.equal((await request('/api/admin/config', { ConfigSubscriptions: [] })).status, 400);
    assert.equal((await request('/api/admin/config', { UserConfig: { Users: [] } })).status, 400);
    assert.equal((await request('/api/admin/config', { LiveRefreshIntervalHours: 10 })).status, 200); await config();
    assert.equal((await request('/api/admin/site', { AnalyticsCustomScript: 'alert(1)' })).status, 403);
    assert.equal((await request('/api/admin/config/history')).status, 403);
    cookie = ownerCookie; await config();
    console.log('PASS: real admin session, field whitelist, owner-only script/history APIs');
    const stream = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
    const mediaPath = '/api/proxy-m3u8?url=' + encodeURIComponent(stream) + '&source=directplay&proxySegments=true&adblock=false';
    const started = Date.now(); const media = await request(mediaPath); const playlist = await media.text();
    assert.equal(media.status, 200, playlist.slice(0,300)); assert.ok(playlist.startsWith('#EXTM3U'));
    const forbidden = await request('/api/proxy-m3u8?url=' + encodeURIComponent('http://127.0.0.1/private'));
    assert.notEqual(forbidden.status, 200); await forbidden.text();
    const fakeDns = docker(['exec',name,'node','-e',"require('dns').promises.lookup('test-streams.mux.dev',{all:true}).then(a=>console.log(JSON.stringify(a)))"]);
    console.log('PASS: media proxy over local DNS', fakeDns, 'playlist time', Date.now() - started, 'ms; loopback remains blocked');
    const playbackUrl = origin + '/play?source=directplay&id=' + bs58.encode(Buffer.from(origin + mediaPath));
    if (process.argv.includes('--keep')) {
      keep = true; fs.writeFileSync('../optimization-qa.json', JSON.stringify({ container: name, origin, username, password, playbackUrl }, null, 2));
      console.log('QA_READY', origin, name);
    }
  } finally { if (!keep) { try { docker(['rm','-f',name]); } catch {} } }
})().catch(error => { console.error(error); process.exitCode = 1; });
