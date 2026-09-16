import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { legadoClient } from '@/lib/legado.client';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

import { getAuthorizedBooksUsername } from '../_utils';

export const runtime = 'nodejs';

const imageCache = new Map<string, { expiresAt: number; contentType: string; data: Uint8Array }>();

interface ImageRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

function asObjectHeader(value?: string | Record<string, string>): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return value.split('\n').reduce<Record<string, string>>((headers, line) => {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      return headers;
    }, {});
  }
}

export async function GET(request: NextRequest) {
  const username = await getAuthorizedBooksUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId') || '';
    const url = searchParams.get('url') || '';
    if (!sourceId || !url) return NextResponse.json({ error: '缺少 sourceId 或 url' }, { status: 400 });
    if (!(await validateProxyUrlServerSide(url))) return NextResponse.json({ error: '图片地址未通过安全校验' }, { status: 400 });
    const source = await legadoClient.getSourceById(sourceId);
    let imageOptions: ImageRequestOptions = {};
    try {
      const rawOptions = searchParams.get('options') || '';
      imageOptions = rawOptions ? (JSON.parse(rawOptions) as ImageRequestOptions) : {};
    } catch {
      imageOptions = {};
    }
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      Referer: source.legado?.bookSourceUrl || source.url,
      ...asObjectHeader(source.legado?.header),
      ...(imageOptions.headers && typeof imageOptions.headers === 'object' ? imageOptions.headers : {}),
    };
    delete headers.Host;
    delete headers.host;
    const cacheKey = crypto.createHash('sha1').update(`${sourceId}|${url}|${JSON.stringify(imageOptions)}`).digest('hex');
    const cached = imageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && !request.headers.get('range')) {
      return new NextResponse(cached.data, { headers: { 'Content-Type': cached.contentType, 'Cache-Control': 'public, max-age=86400' } });
    }
    const range = request.headers.get('range');
    if (range) headers.Range = range;
    const res = await fetch(url, { method: imageOptions.method || 'GET', headers, body: imageOptions.body, cache: 'no-store', redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) return NextResponse.json({ error: '图片重定向缺少地址' }, { status: 502 });
      const redirected = new URL(location, url).toString();
      if (!(await validateProxyUrlServerSide(redirected))) return NextResponse.json({ error: '图片重定向地址未通过安全校验' }, { status: 400 });
      const second = await fetch(redirected, { method: imageOptions.method || 'GET', headers, body: imageOptions.body, cache: 'no-store' });
      if (!second.ok) return NextResponse.json({ error: `图片请求失败: ${second.status}` }, { status: second.status });
      const data = new Uint8Array(await second.arrayBuffer());
      const contentType = second.headers.get('content-type') || 'image/jpeg';
      if (!range) imageCache.set(cacheKey, { data, contentType, expiresAt: Date.now() + 86400_000 });
      return new NextResponse(data, { status: second.status, headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' } });
    }
    if (!res.ok) return NextResponse.json({ error: `图片请求失败: ${res.status}` }, { status: res.status });
    const data = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!range) imageCache.set(cacheKey, { data, contentType, expiresAt: Date.now() + 86400_000 });
    return new NextResponse(data, {
      status: res.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        ...(res.headers.get('content-range') ? { 'Content-Range': res.headers.get('content-range') as string } : {}),
        ...(res.headers.get('accept-ranges') ? { 'Accept-Ranges': res.headers.get('accept-ranges') as string } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '图片代理失败' }, { status: 500 });
  }
}
