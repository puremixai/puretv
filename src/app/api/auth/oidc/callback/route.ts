import { NextRequest, NextResponse } from 'next/server';

import { generateAuthCookieValue } from '@/lib/auth-cookie';
import { setAuthCookies } from '@/lib/auth-response';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// 获取设备信息
function getDeviceInfo(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  // 检查是否为 PureTV APP
  if (ua.includes('puretv')) {
    return 'PureTV APP';
  }

  // 检查是否为 OrionTV
  if (ua.includes('oriontv')) {
    return 'OrionTV';
  }

  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    if (ua.includes('android')) return 'Android Mobile';
    if (ua.includes('iphone')) return 'iPhone';
    return 'Mobile Device';
  }

  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'Tablet';
  }

  if (ua.includes('windows')) return 'Windows PC';
  if (ua.includes('mac')) return 'Mac';
  if (ua.includes('linux')) return 'Linux';

  return 'Unknown Device';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // 使用环境变量SITE_BASE或当前请求的origin
    const origin = process.env.SITE_BASE || request.nextUrl.origin;

    // 检查是否有错误
    if (error) {
      logger.error('OIDC认证错误:', error);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent('OIDC认证失败')}`, origin)
      );
    }

    // 验证必需参数
    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('缺少必需参数'), origin)
      );
    }

    // 验证state
    const storedState = request.cookies.get('oidc_state')?.value;
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('状态验证失败'), origin)
      );
    }

    const config = await getConfig();
    const siteConfig = config.SiteConfig;

    // 检查OIDC配置
    if (!siteConfig.OIDCTokenEndpoint || !siteConfig.OIDCUserInfoEndpoint || !siteConfig.OIDCClientId || !siteConfig.OIDCClientSecret) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('OIDC配置不完整'), origin)
      );
    }

    const redirectUri = `${origin}/api/auth/oidc/callback`;

    // 交换code获取token
    const tokenResponse = await fetch(siteConfig.OIDCTokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: siteConfig.OIDCClientId,
        client_secret: siteConfig.OIDCClientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      logger.error('获取token失败:', await tokenResponse.text());
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('获取token失败'), origin)
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const idToken = tokenData.id_token;

    if (!accessToken || !idToken) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('token无效'), origin)
      );
    }

    // 获取用户信息
    const userInfoResponse = await fetch(siteConfig.OIDCUserInfoEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!userInfoResponse.ok) {
      logger.error('获取用户信息失败:', await userInfoResponse.text());
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('获取用户信息失败'), origin)
      );
    }

    const userInfo = await userInfoResponse.json();
    const oidcSub = userInfo.sub; // OIDC的唯一标识符

    if (!oidcSub) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('用户信息无效'), origin)
      );
    }

    // 检查用户是否已存在(通过OIDC sub查找)
    const username = await db.getUserByOidcSub(oidcSub);
    let userRole: 'owner' | 'admin' | 'user' = 'user';

    if (username) {
      // 获取用户信息
      const userInfoV2 = await db.getUserInfoV2(username);
      if (userInfoV2) {
        userRole = userInfoV2.role;
        // 检查用户是否被封禁
        if (userInfoV2.banned) {
          return NextResponse.redirect(
            new URL('/login?error=' + encodeURIComponent('用户被封禁'), origin)
          );
        }
      }
    }

    if (username) {
      // 用户已存在,直接登录
      const response = NextResponse.redirect(new URL('/', origin));
      const userAgent = request.headers.get('user-agent') || 'Unknown';
      const deviceInfo = getDeviceInfo(userAgent);
      const cookieValue = await generateAuthCookieValue({ username, role: userRole, deviceInfo });
      setAuthCookies(response, cookieValue, request);

      // 清除state cookie
      response.cookies.delete('oidc_state');

      return response;
    }

    // 用户不存在,检查是否允许注册
    if (!siteConfig.EnableOIDCRegistration) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('该OIDC账号未注册'), origin)
      );
    }

    // 需要注册,跳转到用户名输入页面
    // 将OIDC信息存储到session中
    const oidcSession = {
      sub: oidcSub,
      email: userInfo.email,
      name: userInfo.name,
      trust_level: userInfo.trust_level, // 提取trust_level字段
      timestamp: Date.now(),
    };

    const response = NextResponse.redirect(new URL('/oidc-register', origin));
    response.cookies.set('oidc_session', JSON.stringify(oidcSession), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600, // 10分钟
    });

    // 清除state cookie
    response.cookies.delete('oidc_state');

    return response;
  } catch (error) {
    logger.error('OIDC回调处理失败:', error);
    const origin = process.env.SITE_BASE || request.nextUrl.origin;
    return NextResponse.redirect(
      new URL('/login?error=' + encodeURIComponent('服务器错误'), origin)
    );
  }
}
