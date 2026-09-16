import { NextRequest, NextResponse } from 'next/server';

import { generateAuthCookie } from '@/lib/auth-cookie';
import { authResponse, clearAuthCookies, setAuthCookies } from '@/lib/auth-response';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  checkLoginBan,
  getLoginClientIp,
  recordLoginFailure,
  recordLoginSuccess,
} from '@/lib/login-fail2ban';

export const runtime = 'nodejs';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

// 验证Cloudflare Turnstile Token
async function verifyTurnstileToken(token: string, secretKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
    });

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    logger.error('Turnstile验证失败:', error);
    return false;
  }
}

// 获取设备信息
function getDeviceInfo(request: NextRequest): string {
  const userAgent = request.headers.get('user-agent') || 'Unknown';

  // 检查是否为 PureTV APP
  if (userAgent.toLowerCase().includes('puretv')) {
    return 'PureTV APP';
  }

  // 检查是否为 OrionTV
  if (userAgent.toLowerCase().includes('oriontv')) {
    return 'OrionTV';
  }

  // 简单解析 User-Agent
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';

  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iOS')) os = 'iOS';

  return `${browser} on ${os}`;
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = getLoginClientIp(req);
    const banStatus = checkLoginBan(clientIp);
    if (banStatus.banned) {
      return NextResponse.json(
        { error: '登录失败次数过多，请稍后再试' },
        {
          status: 429,
          headers: banStatus.retryAfterSeconds
            ? { 'Retry-After': String(banStatus.retryAfterSeconds) }
            : undefined,
        }
      );
    }

    // 获取站点配置
    const adminConfig = await getConfig();
    const siteConfig = adminConfig.SiteConfig;

    // 本地 / localStorage 模式——仅校验固定密码
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      // 未配置 PASSWORD 时直接放行
      if (!envPassword) {
        const response = authResponse(req);

        // 清除可能存在的认证cookie
        clearAuthCookies(response);

        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (password !== envPassword) {
        recordLoginFailure(clientIp);
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      recordLoginSuccess(clientIp);

      // 验证成功，设置认证cookie
      const username = process.env.USERNAME || 'default';
      const deviceInfo = getDeviceInfo(req);
      const cookieValue = await generateAuthCookie(
        username,
        password,
        'owner',
        true,
        deviceInfo
      ); // localstorage 模式使用签名会话，不保存密码
      const response = authResponse(req, cookieValue);
      const expires = new Date();
      expires.setDate(expires.getDate() + 60); // 60天过期（Refresh Token 有效期）

      setAuthCookies(response, cookieValue, req);

      return response;
    }

    // 数据库 / redis 模式——校验用户名并尝试连接数据库
    const { username, password, turnstileToken } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 如果开启了Turnstile验证
    if (siteConfig.LoginRequireTurnstile) {
      if (!turnstileToken) {
        return NextResponse.json(
          { error: '请完成人机验证' },
          { status: 400 }
        );
      }

      if (!siteConfig.TurnstileSecretKey) {
        logger.error('Turnstile Secret Key未配置');
        return NextResponse.json(
          { error: '服务器配置错误' },
          { status: 500 }
        );
      }

      // 验证Turnstile Token
      const isValid = await verifyTurnstileToken(turnstileToken, siteConfig.TurnstileSecretKey);
      if (!isValid) {
        return NextResponse.json(
          { error: '人机验证失败，请重试' },
          { status: 400 }
        );
      }
    }

    // 可能是站长，直接读环境变量
    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      recordLoginSuccess(clientIp);

      // 验证成功，设置认证cookie
      const deviceInfo = getDeviceInfo(req);
      const cookieValue = await generateAuthCookie(
        username,
        password,
        'owner',
        false,
        deviceInfo
      ); // 数据库模式不包含 password
      const response = authResponse(req, cookieValue);
      const expires = new Date();
      expires.setDate(expires.getDate() + 60); // 60天过期（Refresh Token 有效期）

      setAuthCookies(response, cookieValue, req);

      return response;
    } else if (username === process.env.USERNAME) {
      recordLoginFailure(clientIp);
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    // 使用新版本的用户验证
    let pass = false;
    let userRole: 'owner' | 'admin' | 'user' = 'user';
    let isBanned = false;

    // 验证用户
    const userInfoV2 = await db.getUserInfoV2(username);

    if (userInfoV2) {
      // 使用新版本验证
      pass = await db.verifyUserV2(username, password);
      userRole = userInfoV2.role;
      isBanned = userInfoV2.banned;
    }

    // 检查用户是否被封禁
    if (isBanned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    if (!pass) {
      recordLoginFailure(clientIp);
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    recordLoginSuccess(clientIp);

    // 验证成功，设置认证cookie
    const deviceInfo = getDeviceInfo(req);
    const cookieValue = await generateAuthCookie(
      username,
      password,
      userRole,
      false,
      deviceInfo
    ); // 数据库模式不包含 password
    const response = authResponse(req, cookieValue);
    const expires = new Date();
    expires.setDate(expires.getDate() + 60); // 60天过期（Refresh Token 有效期）

  setAuthCookies(response, cookieValue, req);

    logger.debug(`Cookie已设置`);

    return response;
  } catch (error) {
    logger.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
