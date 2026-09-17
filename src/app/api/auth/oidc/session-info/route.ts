import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getOIDCProvider } from '@/lib/oidc';
import {
  getOIDCProviderFingerprint,
  isOIDCRegistrationAllowed,
  readOIDCRegistration,
} from '@/lib/server/oidc-session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const oidcSessionCookie = request.cookies.get('oidc_session')?.value;

    if (!oidcSessionCookie) {
      return NextResponse.json({ error: 'OIDC会话不存在' }, { status: 404 });
    }

    const oidcSession = await readOIDCRegistration(oidcSessionCookie);
    if (!oidcSession) {
      return NextResponse.json(
        { error: 'OIDC会话无效或已过期' },
        { status: 400 },
      );
    }

    const config = await getConfig();
    const provider = getOIDCProvider(config.SiteConfig, oidcSession.providerId);
    if (
      !provider ||
      oidcSession.fingerprint !==
        (await getOIDCProviderFingerprint(provider)) ||
      !isOIDCRegistrationAllowed(provider, oidcSession.trust_level)
    ) {
      return NextResponse.json(
        { error: 'OIDC注册不可用，请重新登录' },
        { status: 403 },
      );
    }

    // 返回用户信息(不包含sub)
    return NextResponse.json({
      email: oidcSession.email,
      name: oidcSession.name,
      trust_level: oidcSession.trust_level,
    });
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
