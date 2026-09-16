#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
const { getCronSecret } = require('./server/cron-auth');
const http = require('http');
const path = require('path');

// 调用 generate-manifest.js 生成 manifest.json
function generateManifest() {
  console.log('Generating manifest.json for Docker deployment...');

  try {
    const generateManifestScript = path.join(
      __dirname,
      'scripts',
      'generate-manifest.js'
    );
    require(generateManifestScript);
  } catch (error) {
    console.error('❌ Error calling generate-manifest.js:', error);
    throw error;
  }
}

generateManifest();

// 直接在当前进程中启动 standalone Server（`server.js`）
require('./server.js');

// 每 1 秒轮询一次，直到请求成功
const bindHost = process.env.HOSTNAME || 'localhost';
const probeHost = ['0.0.0.0', '::'].includes(bindHost) ? '127.0.0.1' : bindHost;
const localOrigin = `http://${probeHost.includes(':') ? `[${probeHost}]` : probeHost}:${process.env.PORT || 3000}`;
const TARGET_URL = `${localOrigin}/login`;

const intervalId = setInterval(() => {
  console.log(`Fetching ${TARGET_URL} ...`);

  const req = http.get(TARGET_URL, (res) => {
    res.resume();
    // 当返回 2xx 状态码时认为成功，然后停止轮询
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      console.log('Server is up, stop polling.');
      clearInterval(intervalId);

      setTimeout(() => {
        // 服务器启动后，立即执行一次 cron 任务
        executeCronJob();
      }, 3000);

      // 然后设置每小时执行一次 cron 任务
      setInterval(() => {
        executeCronJob();
      }, 60 * 60 * 1000); // 每小时执行一次
    }
  });

  req.on('error', () => { /* The server may still be starting; the next poll retries. */ });
  req.setTimeout(2000, () => {
    req.destroy();
  });
}, 1000);

// 执行 cron 任务的函数
function executeCronJob() {
  const cronPassword = getCronSecret();
  if (!cronPassword) return;
  const cronUrl = `${localOrigin}/api/cron/run`;

  console.log(`Executing cron job: ${cronUrl}`);

  const req = http.get(cronUrl, { headers: { Authorization: `Bearer ${cronPassword}` } }, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Cron job executed successfully:', data);
      } else {
        console.error('Cron job failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Error executing cron job:', err);
  });

  req.setTimeout(30000, () => {
    console.error('Cron job timeout');
    req.destroy();
  });
}
