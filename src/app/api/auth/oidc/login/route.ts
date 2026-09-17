import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getOIDCProvider } from '@/lib/oidc';
import {
  createOIDCTransaction,
  OIDC_SESSION_MAX_AGE,
} from '@/lib/server/oidc-session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const config = await getConfig();
    const provider = getOIDCProvider(
      config.SiteConfig,
      request.nextUrl.searchParams.get('provider'),
    );

    // 检查是否启用OIDC登录
    if (!provider) {
      return NextResponse.json(
        { error: 'OIDC提供商不可用，请选择已启用的登录方式' },
        { status: 403 },
      );
    }

    // 检查OIDC配置
    if (!provider.authorizationEndpoint || !provider.clientId) {
      return NextResponse.json(
        { error: 'OIDC配置不完整，请配置Authorization Endpoint和Client ID' },
        { status: 500 },
      );
    }

    // 生成state参数用于防止CSRF攻击
    const state = crypto.randomUUID();

    // 使用环境变量SITE_BASE或当前请求的origin
    const origin = (process.env.SITE_BASE || request.nextUrl.origin)
      .trim()
      .replace(/\/+$/, '');
    const redirectUri = `${origin}/api/auth/oidc/callback`;

    // 构建授权URL
    const authUrl = new URL(provider.authorizationEndpoint);
    authUrl.searchParams.set('client_id', provider.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);

    // 将state存储到cookie中
    const response = NextResponse.redirect(authUrl);

    response.cookies.set(
      'oidc_state',
      await createOIDCTransaction(provider, state),
      {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(origin).protocol === 'https:',
        maxAge: OIDC_SESSION_MAX_AGE,
      },
    );

    return response;
  } catch (error) {
    logger.error('OIDC登录发起失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
