/* eslint-disable @typescript-eslint/no-explicit-any */
import { DOMParser } from '@xmldom/xmldom';
import * as cheerio from 'cheerio/slim';
import crypto from 'crypto';
import he from 'he';
import vm from 'vm';
import xpath from 'xpath';

import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

import {
  BookAcquisitionLink,
  BookCatalogResult,
  BookChapter,
  BookChapterContent,
  BookDetail,
  BookListItem,
  BookSearchFailure,
  BookSearchResult,
  BookSource,
  BookSourceCapabilities,
  LegadoBookSourceRule,
  LegadoRuleSearch,
} from './book.types';
import { getConfig } from './config';
import { legadoSubscriptionStore } from './legado/subscription-store';

interface ResolvedLegadoConfig {
  enabled: boolean;
  sources: BookSource[];
  cacheTTL: number;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.LEGADO_TIMEOUT_MS || process.env.OPDS_TIMEOUT_MS || 20000);
const MAX_TEXT_BYTES = Number(process.env.LEGADO_MAX_TEXT_BYTES || 3 * 1024 * 1024);
const DEFAULT_LEGADO_SEARCH_PAGES = Number(process.env.LEGADO_SEARCH_PAGES || 5);
const textCache = new Map<string, { expiresAt: number; data: string }>();
const searchCache = new Map<string, { expiresAt: number; data: BookListItem[] }>();
const detailCache = new Map<string, { expiresAt: number; data: BookDetail }>();
const tocCache = new Map<string, { expiresAt: number; data: BookChapter[] }>();
const chapterCache = new Map<string, { expiresAt: number; data: BookChapterContent }>();

interface RequestOptions {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  charset?: string;
  retry?: number;
}

const cookieJar = new Map<string, string>();
const variableStore = new Map<string, any>();

function stableId(input: string) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function isSafeHeaderName(name: string) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function isJsRuleString(value?: string) {
  const trimmed = (value || '').trim();
  return /^(?:@js:|<js>)/i.test(trimmed) || /<js>[\s\S]*?<\/js>/i.test(trimmed);
}

function resolveLegadoDynamicValue(value: any, context: Record<string, any>, timeout = 1000): any {
  if (Array.isArray(value)) return value.map((item) => resolveLegadoDynamicValue(item, context, timeout));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    if (!isJsRuleString(value)) return value;
    return evaluateJsRuleString(value, context, timeout);
  }
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolveLegadoDynamicValue(val, context, timeout)]));
}

function evaluateJsRuleString(value: string, context: Record<string, any>, timeout = 1000) {
  const trimmed = value.trim();
  if (/^(?:@js:|<js>)/i.test(trimmed)) return runJsSnippet(trimmed, context, timeout);
  return value.replace(/<js>([\s\S]*?)<\/js>/gi, (_, code) => runJsSnippet(code, context, timeout));
}

function parseHeaderLines(raw: string, context: Record<string, any>) {
  return raw.split('\n').reduce<Record<string, string>>((headers, line) => {
    const index = line.indexOf(':');
    if (index <= 0) return headers;
    const name = line.slice(0, index).trim();
    if (!isSafeHeaderName(name)) return headers;
    const value = line.slice(index + 1).trim();
    headers[name] = isJsRuleString(value) ? evaluateJsRuleString(value, context) : value;
    return headers;
  }, {});
}

function asObjectHeader(value?: string | Record<string, string>, context?: Record<string, any>): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'object') return resolveLegadoDynamicValue(value, context || {});
  let raw = value.trim();
  if (isJsRuleString(raw)) {
    raw = evaluateJsRuleString(raw, context || {});
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return resolveLegadoDynamicValue(parsed, context || {});
  } catch {
    return parseHeaderLines(raw, context || {});
  }
}

function resolveLegadoRule(rule?: LegadoBookSourceRule, source?: BookSource): LegadoBookSourceRule | undefined {
  if (!rule) return rule;
  const base = source?.url || rule.bookSourceUrl || '';
  const context = { baseUrl: base, source: rule };
  return resolveLegadoDynamicValue(rule, context);
}

function resolveLegadoSource(source: BookSource): BookSource {
  const rule = resolveLegadoRule(source.legado, source);
  const resolved: BookSource = {
    ...source,
    legado: rule,
  };
  return resolveLegadoDynamicValue(resolved, { baseUrl: source.url || rule?.bookSourceUrl || '', source: rule || source.legado || source });
}

function buildHeaders(source: BookSource): HeadersInit {
  const rule = source.legado;
  const baseUrl = sourceBase(source);
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...asObjectHeader(rule?.header, { baseUrl, source: rule }),
  };
  if (source.authMode === 'header' && source.headerName && source.headerValue) headers[source.headerName] = source.headerValue;
  if (source.authMode === 'basic' && source.username) headers.Authorization = `Basic ${Buffer.from(`${source.username}:${source.password || ''}`).toString('base64')}`;
  delete headers.Host;
  delete headers.host;
  delete headers['Content-Length'];
  delete headers['content-length'];
  return headers;
}

function sourceBase(source: BookSource) {
  return source.legado?.bookSourceUrl || source.url;
}

function normalizeUrl(base: string, href?: string): string {
  if (!href) return base;
  const trimmed = href.trim();
  if (!trimmed) return base;
  if (/^javascript:/i.test(trimmed)) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    // 部分 Legado 源会把 bookSourceUrl 当作名称，真实服务端地址放在变量里。
    // 无法解析相对地址时保留原值，让上层给出更准确的“非 HTTP URL”错误，而不是直接 Invalid URL。
    return trimmed;
  }
}

function encodeRuleParam(value: string) {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function encryptTongrenKeyword(plainText: string) {
  const passphrase = 'zc89s30ipHG2Dw';
  const key = Buffer.alloc(32);
  const iv = Buffer.alloc(16);
  Buffer.from(passphrase).copy(key);
  Buffer.from(passphrase).copy(iv);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return encodeURIComponent(Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]).toString('base64'));
}

function decryptTongrenOpenUrl(encryptedBase64: string, num: string, source?: LegadoBookSourceRule) {
  try {
    const numStr = Buffer.from(String(num || ''), 'base64').toString('utf8');
    const userAgent = (asObjectHeader(source?.header)['User-Agent'] || 'Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36').toLowerCase();
    const key = Buffer.from(crypto.createHash('md5').update(userAgent + numStr).digest('hex'), 'utf8');
    const encryptedData = Buffer.from(String(encryptedBase64 || ''), 'base64');
    const iv = encryptedData.subarray(0, 16);
    const data = encryptedData.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function safeEvalTemplateExpression(expr: string, keyword: string, page: number) {
  const key = keyword;
  const searchTerms = keyword;
  const java = {
    base64Encode: (value: unknown) => Buffer.from(String(value ?? ''), 'utf8').toString('base64'),
    base64Decode: (value: unknown) => Buffer.from(String(value ?? ''), 'base64').toString('utf8'),
    encodeURI: (value: unknown) => encodeURIComponent(String(value ?? '')),
    encodeURIComponent: (value: unknown) => encodeURIComponent(String(value ?? '')),
  };
  try {
    const fn = new Function('key', 'keyword', 'searchTerms', 'page', 'java', `return (${expr});`);
    return jsonPrimitiveToString(fn(key, keyword, searchTerms, page, java));
  } catch {
    return '';
  }
}

function renderTemplateExpressions(raw: string, keyword = '', page = 1) {
  return raw.replace(/<([^,<>]*),\s*\{\{(.*?)\}\}>/g, (_, prefix, expr) => {
    const value = safeEvalTemplateExpression(String(expr).trim(), keyword, page);
    return value ? `${prefix || ''}${value}` : '';
  }).replace(/\{\{(.*?)\}\}/g, (_, expr) => {
    const value = String(expr).trim();
    if (/^(key|keyword|searchTerms)$/.test(value)) return encodeRuleParam(keyword || '');
    if (/^(page|pageIndex)$/.test(value)) return String(page);
    const evaluated = safeEvalTemplateExpression(value, keyword, page);
    // 表达式里如果已经显式调用 encodeURIComponent/encodeURI/java.encodeURI，
    // 结果就是编码后的参数，不能再 encode 一次，否则会把 % 编成 %25。
    if (/\b(?:encodeURIComponent|encodeURI|java\.encodeURI|java\.encodeURIComponent)\s*\(/.test(value)) return evaluated;
    return encodeRuleParam(evaluated);
  });
}


function unwrapJsRule(code: string) {
  const raw = String(code || '').trim();
  const block = raw.match(/^<js>([\s\S]*?)<\/js>$/i);
  if (block) return block[1].trim();
  return raw.replace(/^@js:/, '').trim();
}

function parseArguments(value?: string) {
  const out: Record<string, string> = {};
  String(value || '').split(/[&;\n]+/).forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
  });
  return out;
}

function makeSourceRuntime(source: any, baseUrl?: string) {
  const raw = source || {};
  const variable = raw.variable || raw.loginUrl || raw.bookSourceUrl || baseUrl || '';
  return {
    ...raw,
    getVariable: () => variable,
    getLoginInfoMap: () => ({}),
    getKey: () => raw.key || raw.bookSourceUrl || baseUrl || '',
  };
}

function runJsSnippetRaw(code: string, context: Record<string, any>, timeout = 1000): any {
  const sourceRuntime = makeSourceRuntime(context.source, context.baseUrl);
  let lastPut: any = null;
  const java = {
    base64Encode: (value: unknown) => Buffer.from(String(value ?? ''), 'utf8').toString('base64'),
    base64Decode: (value: unknown) => Buffer.from(String(value ?? ''), 'base64').toString('utf8'),
    md5Encode: (value: unknown) => crypto.createHash('md5').update(String(value ?? '')).digest('hex'),
    strToBytes: (value: unknown) => Buffer.from(String(value ?? ''), 'utf8'),
    base64DecodeToByteArray: (value: unknown) => Buffer.from(String(value ?? ''), 'base64'),
    hexDecodeToString: (value: unknown) => Buffer.from(String(value ?? ''), 'hex').toString('utf8'),
    ajax: () => '',
    getWebViewUA: () => 'Mozilla/5.0 (Linux; Android 10) Mobile Safari/537.36',
    getElements: (selectorRule: string) => {
      const raw = jsonPrimitiveToString(context.result ?? context.src ?? '');
      if (!raw) return [];
      const $ = cheerio.load(raw);
      let nodes = selectElements($, $.root(), selectorRule);
      if (nodes.length === 0 && /#chapter-items@a/.test(selectorRule)) nodes = $('#chapter-items').find('a');
      return nodes.toArray().map((element) => {
        const node = $(element);
        const attrs = (element as any).attribs || {};
        return { ...attrs, text: node.text().trim(), href: attrs.href, src: attrs.src, html: node.html() || '' };
      });
    },
    deviceID: () => '',
    androidId: () => '',
    longToast: () => undefined,
    toast: () => undefined,
    startBrowserAwait: () => ({ body: () => '' }),
    encodeURI: (value: unknown) => encodeURIComponent(String(value ?? '')),
    encodeURIComponent: (value: unknown) => encodeURIComponent(String(value ?? '')),
    put: (key: string, value: any) => { lastPut = { key, value }; variableStore.set(key, value); return value; },
    get: (key: string) => variableStore.get(key),
    log: () => undefined,
    htmlFormat: (value: unknown) => he.decode(String(value ?? '')).replace(/<br\s*\/?/gi, '\n').replace(/<[^>]+>/g, ''),
  };
  const cookie = {
    getCookie: () => '',
    removeCookie: () => undefined,
    mapToCookie: (input: any) => typeof input === 'string' ? input : Array.isArray(input) ? input.join('; ') : '',
  };
  const sandbox: Record<string, any> = {
    ...context,
    source: sourceRuntime,
    book: context.book || {},
    java,
    cookie,
    Buffer,
    JSON,
    String,
    Number,
    Math,
    Array,
    Object,
    encodeURIComponent,
    encryptText: encryptTongrenKeyword,
    openUrl: (encryptedText: string, num: string) => decryptTongrenOpenUrl(encryptedText, num, context.source),
    getArguments: (value: string, key?: string) => key ? (parseArguments(value)[key] || '') : parseArguments(value),
    console: { log: () => undefined },
  };
  const body = unwrapJsRule(code);
  try {
    const script = new vm.Script(`(function(){ ${body}\n})()`);
    const result = script.runInNewContext(sandbox, { timeout });
    if (result !== undefined && result !== null && result !== '') return result;
    if (sandbox.result !== context.result && sandbox.result !== undefined && sandbox.result !== null && sandbox.result !== '') return sandbox.result;
    if (lastPut?.key === 'url') return lastPut.value;
  } catch {
    // 如果 @js 后面是单个表达式（例如 header: @js:JSON.stringify({...})），上面的函数体不会自动返回。
  }
  try {
    const script = new vm.Script(`(function(){ ${body}
; if (typeof res !== 'undefined') return res; return ''; })()`);
    const result = script.runInNewContext(sandbox, { timeout });
    if (result !== undefined && result !== null && result !== '') return result;
    if (sandbox.result !== context.result && sandbox.result !== undefined && sandbox.result !== null && sandbox.result !== '') return sandbox.result;
    if (lastPut?.key === 'url') return lastPut.value;
  } catch {
    // fallback to expression mode below
  }
  try {
    const script = new vm.Script(`(function(){ return (${body}); })()`);
    const result = script.runInNewContext(sandbox, { timeout });
    if (result !== undefined && result !== null && result !== '') return result;
    if (sandbox.result !== context.result && sandbox.result !== undefined && sandbox.result !== null && sandbox.result !== '') return sandbox.result;
    if (lastPut?.key === 'url') return lastPut.value;
    return '';
  } catch {
    return '';
  }
}

function runJsSnippet(code: string, context: Record<string, any>, timeout = 1000): string {
  return jsonPrimitiveToString(runJsSnippetRaw(code, context, timeout));
}

function applyPutGetRules(rule: string, value: string) {
  const putMatch = rule.match(/@put:\s*\{([\s\S]*?)\}/);
  if (putMatch) {
    try {
      const obj = JSON.parse(`{${putMatch[1]}}`);
      Object.entries(obj).forEach(([key, val]) => variableStore.set(key, val));
    } catch {
      const pair = putMatch[1].match(/([A-Za-z0-9_$-]+)\s*:\s*['"]?([^,'"]+)['"]?/);
      if (pair) variableStore.set(pair[1], value || pair[2]);
    }
  }
  const getMatch = rule.match(/@get:\s*\{\s*([A-Za-z0-9_$-]+)\s*\}/);
  if (getMatch) return jsonPrimitiveToString(variableStore.get(getMatch[1]));
  return value;
}

function buildUrlFromTemplate(template: string, source: BookSource, keyword?: string, page = 1, baseOverride?: string) {
  const base = baseOverride || sourceBase(source);
  let raw = template || base;
  if (isJsRuleString(raw)) {
    if (/\/k-\{\{encryptText\(key\)\}\}-\{\{page\}\}\.html/.test(raw)) {
      return `https://www.rrssk.com/k-${encryptTongrenKeyword(keyword || '')}-${page}.html`;
    }
    const evaluated = evaluateJsRuleString(raw, { key: keyword || '', keyword: keyword || '', page, baseUrl: base, source: { ...(source.legado || {}), key: base } });
    raw = evaluated || raw;
    if (/,(\s*)\{/.test(raw)) return raw;
  }
  raw = renderTemplateExpressions(raw, keyword || '', page);
  raw = raw
    .replace(/\{searchTerms\}/g, encodeRuleParam(keyword || ''))
    .replace(/\{key\}/g, encodeRuleParam(keyword || ''))
    .replace(/\{keyword\}/g, encodeRuleParam(keyword || ''))
    .replace(/\{page\}/g, String(page))
    .replace(/\{pageIndex\}/g, String(page));
  return normalizeUrl(base, raw);
}

function stripRuleJsBlocks(rule?: string) {
  return (rule || '').replace(/<js>[\s\S]*?<\/js>/gi, '').trim();
}

function applyRuleJsBlocks(raw: string, rule?: string) {
  const blocks = Array.from((rule || '').matchAll(/<js>([\s\S]*?)<\/js>/gi));
  for (const block of blocks) {
    runJsSnippet(block[1], { src: raw, result: raw });
  }
}

function parseJsonMaybe(value: string): any | null {
  try {
    return JSON.parse(value.trim());
  } catch {
    return null;
  }
}

function jsonPrimitiveToString(value: any): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(jsonPrimitiveToString).filter(Boolean).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readJsonPath(input: any, path?: string): any {
  if (!path) return input;
  let normalized = path.trim();
  if (normalized.startsWith('@json:')) normalized = normalized.slice(6);
  if (normalized.startsWith('-@json:')) normalized = normalized.slice(7);
  if (!normalized || normalized === '$') return input;

  const filterMatch = normalized.match(/^(.*)\[\?\(@\.([A-Za-z0-9_$-]+)\s*(==|=|!=)\s*['"]?([^'"\]]+)['"]?\)\](.*)$/);
  if (filterMatch) {
    const base = readJsonPath(input, filterMatch[1] || '$');
    const list = Array.isArray(base) ? base : [];
    const filtered = list.filter((item) => {
      const actual = jsonPrimitiveToString(item?.[filterMatch[2]]);
      return filterMatch[3] === '!=' ? actual !== filterMatch[4] : actual === filterMatch[4];
    });
    return filterMatch[5] ? readJsonPath(filtered, `$${filterMatch[5]}`) : filtered;
  }

  const recursive = normalized.match(/^\$\.\.([A-Za-z0-9_$-]+)(.*)$/);
  if (recursive) {
    const key = recursive[1];
    const rest = recursive[2] || '';
    const out: any[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node[key] !== undefined) out.push(node[key]);
      Object.values(node).forEach(walk);
    };
    walk(input);
    return rest ? readJsonPath(out.flat(), `$${rest}`) : out.flat();
  }

  normalized = normalized.replace(/^\$\.?/, '');
  const tokens = normalized.match(/[^.[\]]+|\[\*\]|\[-?\d+\]|\[-?\d*:-?\d*(?::-?\d+)?\]|\[['"][^\]]+['"](?:,\s*['"][^\]]+['"])*\]/g) || [];
  let current = input;
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    if (token === '[*]') {
      current = Array.isArray(current) ? current.flat() : [];
    } else if (/^\[-?\d+\]$/.test(token)) {
      const idx = Number(token.slice(1, -1));
      current = Array.isArray(current) ? current[idx < 0 ? current.length + idx : idx] : undefined;
    } else if (/^\[-?\d*:-?\d*/.test(token)) {
      if (!Array.isArray(current)) return [];
      const parts = token.slice(1, -1).split(':').map((item) => item === '' ? undefined : Number(item));
      const start = parts[0] === undefined ? 0 : parts[0] < 0 ? current.length + parts[0] : parts[0];
      const end = parts[1] === undefined ? current.length : parts[1] < 0 ? current.length + parts[1] : parts[1];
      const step = parts[2] || 1;
      const sliced = current.slice(start, end);
      current = step === 1 ? sliced : sliced.filter((_, index) => index % Math.abs(step) === 0);
    } else if (/^\[/.test(token)) {
      const keys = Array.from(token.matchAll(/['"]([^'"]+)['"]/g)).map((m) => m[1]);
      if (Array.isArray(current)) current = current.map((item) => keys.map((key) => item?.[key])).flat().filter((item) => item !== undefined);
      else current = keys.map((key) => current?.[key]).filter((item) => item !== undefined);
    } else if (Array.isArray(current)) {
      current = current.map((item) => item?.[token]).filter((item) => item !== undefined);
    } else {
      current = current[token];
    }
  }
  return current;
}

function ruleIsJson(rule?: string) {
  return !!rule && /@json:|-@json:|^\$\./.test(rule.trim());
}

function selectJsonItems(json: any, rule?: string): any[] {
  const alternatives = splitAlternatives(rule);
  for (let index = 0; index < alternatives.length; index += 1) {
    const alternative = alternatives[index];
    const reverse = alternative.trim().startsWith('-');
    const value = readJsonPath(json, alternative);
    if (Array.isArray(value) && value.length > 0) return reverse ? [...value].reverse() : value;
    // 备用 JSONPath 常见写法：$.data||$.data.data[*]。前者可能是分页包装对象，优先继续尝试后续数组规则。
    if (value && typeof value === 'object' && index === alternatives.length - 1) return [value];
    if (value && typeof value !== 'object') return [value];
  }
  return [];
}

function evaluateJsListRule(rule: string | undefined, context: Record<string, any>): any[] {
  const trimmed = (rule || '').trim();
  if (!isJsRuleString(trimmed)) return [];
  const elementRules = Array.from(trimmed.matchAll(/java\.getElements\(\s*(['"`])([\s\S]*?)\1\s*\)/g)).map((match) => match[2]).filter(Boolean);
  if (elementRules.length > 0) {
    const raw = jsonPrimitiveToString(context.result ?? context.src ?? '');
    const $ = cheerio.load(raw);
    for (const selectorRule of elementRules) {
      let nodes = selectElements($, $.root(), selectorRule);
      if (nodes.length === 0 && /#chapter-items@a/.test(selectorRule)) nodes = $('#chapter-items').find('a');
      const items = nodes.toArray().map((element) => {
        const node = $(element);
        const attrs = (element as any).attribs || {};
        return { ...attrs, text: node.text().trim(), href: attrs.href, src: attrs.src, html: node.html() || '' };
      });
      if (items.length > 0) return items;
    }
  }
  const value = runJsSnippetRaw(trimmed, context);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  if (typeof value === 'string') {
    const parsed = parseJsonMaybe(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  }
  return [];
}

function renderTemplateWithJson(template: string, json: any, source: BookSource, baseUrl: string) {
  const rendered = template.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
    const normalizedExpr = String(expr).trim().replace(/^@json:/, '');
    const value = readJsonPath(json, normalizedExpr);
    return encodeRuleParam(jsonPrimitiveToString(value));
  });
  return normalizeUrl(baseUrl || sourceBase(source), rendered);
}

function readJsonRule(json: any, rule?: string, source?: BookSource, baseUrl?: string): string {
  if (!rule) return '';
  const trimmed = rule.trim();
  if (trimmed.includes('{{')) return renderTemplateWithJson(trimmed, json, source as BookSource, baseUrl || sourceBase(source as BookSource));
  if (isJsRuleString(trimmed)) {
    if (/result\s*=\s*['"]([^'"]+)['"]\s*\+\s*result\.([A-Za-z0-9_$-]+)/.test(trimmed)) {
      const match = trimmed.match(/result\s*=\s*['"]([^'"]+)['"]\s*\+\s*result\.([A-Za-z0-9_$-]+)/);
      return normalizeUrl(baseUrl || sourceBase(source as BookSource), `${match?.[1] || ''}${jsonPrimitiveToString(json?.[match?.[2] || ''])}`);
    }
    if (/item\.img|\.reverse\(\)/.test(trimmed)) {
      const data = Array.isArray(json?.data) ? [...json.data].reverse() : Array.isArray(json) ? [...json].reverse() : [];
      return data
        .map((item) => item?.img ? `<img src="${String(item.img)}" style="max-width:100%; display:block;" referrerpolicy="no-referrer">` : '')
        .filter(Boolean)
        .join('');
    }
    const resultText = typeof json === 'string' ? json : JSON.stringify(json);
    if (/java\.base64Decode/.test(trimmed)) return Buffer.from(resultText, 'base64').toString('utf8');
    if (/java\.base64Encode/.test(trimmed)) return Buffer.from(resultText, 'utf8').toString('base64');
    if (/java\.md5Encode/.test(trimmed)) return crypto.createHash('md5').update(resultText).digest('hex');
    const replaceMatch = trimmed.match(/result\.replace\(\s*\/([^/]+)\/[gimuy]*\s*,\s*['"]([^'"]*)['"]\s*\)/);
    if (replaceMatch) return resultText.replace(new RegExp(replaceMatch[1], 'g'), replaceMatch[2]);
    const matchMatch = trimmed.match(/result\.match\(\s*\/([^/]+)\/[gimuy]*\s*\)/);
    if (matchMatch) return resultText.match(new RegExp(matchMatch[1]))?.[1] || resultText.match(new RegExp(matchMatch[1]))?.[0] || '';
    return runJsSnippet(trimmed, { result: json, baseUrl, src: json });
  }
  const value = readJsonPath(json, trimmed);
  const text = jsonPrimitiveToString(value);
  if ((/url|href|pic|cover/i.test(trimmed) || /^https?:\/\//i.test(text)) && text && baseUrl) return normalizeUrl(baseUrl, text);
  return text;
}

function fallbackChapterHrefFromItem(item: any, rule?: string, baseUrl?: string): string {
  const id = jsonPrimitiveToString(item?.id || item?.cid || item?.chapter_id || item?.chapterId);
  if (!id) return '';
  const match = (rule || '').match(/['"]([^'"]*(?:pic|chapter)[^'"]*(?:cid|id)=)['"]/i);
  if (match?.[1]) return normalizeUrl(baseUrl || '', `${match[1]}${id}`);
  return '';
}

function splitAlternatives(rule?: string): string[] {
  return (rule || '').split('||').map((item) => item.trim()).filter(Boolean);
}

function splitRuleFilters(rule: string) {
  const parts = (rule || '').split('##');
  return { base: (parts.shift() || '').trim(), filters: parts };
}

function applyRuleFilters(value: string, filters: string[]) {
  let result = value;
  for (let index = 0; index < filters.length; index += 2) {
    const pattern = filters[index];
    const replacement = filters[index + 1] ?? '';
    if (!pattern) continue;
    try {
      result = result.replace(new RegExp(pattern, 'g'), replacement.replace(/\$(\d+)/g, '$$$$1'));
    } catch {
      result = result.split(pattern).join(replacement);
    }
  }
  return result;
}

function readAllInOneList(raw: string, rule?: string): Array<Record<string, string>> {
  const trimmed = (rule || '').trim();
  if (!trimmed.startsWith(':')) return [];
  const pattern = trimmed.slice(1);
  try {
    const regex = new RegExp(pattern, 'gs');
    const out: Array<Record<string, string>> = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      const groups = (match.groups || {}) as Record<string, string>;
      const item: Record<string, string> = { _0: match[0] };
      Array.from(match).forEach((value: string | undefined, index: number) => { item[`_${index}`] = value || ''; });
      Object.entries(groups).forEach(([key, value]) => { item[key] = String(value || ''); });
      out.push(item);
      if (match[0] === '') regex.lastIndex += 1;
    }
    return out;
  } catch {
    return [];
  }
}

function readRegexItem(item: Record<string, string>, rule?: string, baseUrl?: string) {
  const key = (rule || '').trim().replace(/^\$?\{?/, '').replace(/\}?$/, '');
  const value = item[key] || item[`_${key}`] || '';
  if ((/url|href|src|cover/i.test(key) || /^https?:\/\//i.test(value)) && value && baseUrl) return normalizeUrl(baseUrl, value);
  return value;
}

function isLegadoAttrToken(value: string) {
  return /^(href|src|title|alt|text|textNodes|ownText|all|html|content|value|data-[\w-]+)$/i.test(value.trim());
}

function normalizeLegadoSelector(selector: string) {
  const trimmed = selector.trim();
  if (!trimmed) return '';
  const classMatch = trimmed.match(/^class\.([\w-]+(?:\.[\w-]+)*)$/i);
  if (classMatch) return classMatch[1].split('.').map((item) => `.${item}`).join('');
  const idMatch = trimmed.match(/^id\.([\w-]+)$/i);
  if (idMatch) return `#${idMatch[1]}`;
  const tagMatch = trimmed.match(/^tag\.([\w-]+)$/i);
  if (tagMatch) return tagMatch[1];
  return trimmed;
}

function parseStep(step: string): { selector: string; attr: string } {
  const trimmed = step.trim();
  if (isLegadoAttrToken(trimmed)) return { selector: '', attr: trimmed };

  const parts = trimmed.split('@').map((item) => item.trim()).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    const hasAttr = isLegadoAttrToken(last);
    const selectorParts = hasAttr ? parts.slice(0, -1) : parts;
    return {
      selector: selectorParts.map(normalizeLegadoSelector).filter(Boolean).join(' '),
      attr: hasAttr ? last : '',
    };
  }

  const attrMatch = trimmed.match(/(?:@|::)(text|textNodes|ownText|all|html|href|src|title|alt|content|value|data-[\w-]+)$/i);
  if (attrMatch) {
    return { selector: normalizeLegadoSelector(trimmed.slice(0, attrMatch.index).trim()), attr: attrMatch[1] };
  }
  const dotAttr = trimmed.match(/\.(text|html|href|src)$/i);
  if (dotAttr) return { selector: normalizeLegadoSelector(trimmed.slice(0, dotAttr.index).trim()), attr: dotAttr[1] };
  return { selector: normalizeLegadoSelector(trimmed), attr: '' };
}

function stripFilters(rule: string) {
  return splitRuleFilters(stripRuleJsBlocks(rule)).base;
}

function applyLegadoIndexSelector(current: cheerio.Cheerio<any>, selector: string): { current: cheerio.Cheerio<any>; selector: string } {
  let normalized = selector.trim();
  const exclude = normalized.match(/(?:\[!(-?\d+)\]|!(-?\d+))$/);
  if (exclude) {
    normalized = normalized.slice(0, exclude.index).trim();
    current = normalized ? current.find(normalized) : current;
    const idx = Number(exclude[1] ?? exclude[2]);
    const real = idx < 0 ? current.length + idx : idx;
    return { current: current.filter((index) => index !== real), selector: '' };
  }
  const range = normalized.match(/(?:\[(-?\d*):(-?\d*)(?::(-?\d+))?\]|\.(-?\d*):(-?\d*)(?::(-?\d+))?)$/);
  if (range) {
    normalized = normalized.slice(0, range.index).trim();
    current = normalized ? current.find(normalized) : current;
    const length = current.length;
    const startRaw = range[1] ?? range[4];
    const endRaw = range[2] ?? range[5];
    const start = startRaw ? Number(startRaw) : 0;
    const end = endRaw ? Number(endRaw) : length;
    const realStart = start < 0 ? length + start : start;
    const realEnd = end < 0 ? length + end : end;
    const step = Number(range[3] ?? range[6] ?? 1) || 1;
    const sliced = current.slice(realStart, realEnd);
    return { current: step === 1 ? sliced : sliced.filter((_, index) => index % Math.abs(step) === 0), selector: '' };
  }
  const indexMatch = normalized.match(/(?:\[(-?\d+)\]|\.(-?\d+))$/);
  if (indexMatch) {
    normalized = normalized.slice(0, indexMatch.index).trim();
    current = normalized ? current.find(normalized) : current;
    const idx = Number(indexMatch[1] ?? indexMatch[2]);
    const real = idx < 0 ? current.length + idx : idx;
    return { current: current.eq(real), selector: '' };
  }
  return { current, selector: normalized };
}

function applyLegadoSelector($: cheerio.CheerioAPI, current: cheerio.Cheerio<any>, selector: string): cheerio.Cheerio<any> {
  const normalized = selector.trim();
  if (!normalized) return current;
  const textMatch = normalized.match(/^text\.(.+)$/);
  if (textMatch) {
    const keyword = textMatch[1].trim();
    const links = current.find('a[href]').filter((_, el) => $(el).text().includes(keyword));
    if (links.length > 0) return links;
    return current.find('button,span,div,p,li,a').filter((_, el) => $(el).text().includes(keyword));
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (
    tokens.length > 1
    && tokens.every((token) => !/[>+~]/.test(token))
    && tokens.some((token) => /(?:\[!?-?\d+\]|\[-?\d*:|-?\d+\]$|\.-?\d+(?::-?\d*){0,2})$/.test(token))
  ) {
    let next = current;
    for (const token of tokens) {
      const indexed = applyLegadoIndexSelector(next, token);
      next = indexed.selector ? next.find(indexed.selector) : indexed.current;
    }
    return next;
  }
  const indexed = applyLegadoIndexSelector(current, normalized);
  return indexed.selector ? current.find(indexed.selector) : indexed.current;
}

function selectElements($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, rule?: string): cheerio.Cheerio<any> {
  for (const alternative of splitAlternatives(rule)) {
    try {
      const normalized = stripFilters(alternative || '');
      const reverse = normalized.trim().startsWith('-') && !normalized.trim().startsWith('-@');
      const effective = reverse ? normalized.trim().slice(1).trim() : normalized;
      if (!effective) continue;
      const steps = effective.split(/&&|@css:/).map((item) => item.trim()).filter(Boolean);
      let current = root;
      for (const rawStep of steps) {
        const { selector, attr } = parseStep(rawStep);
        if (attr) break;
        if (!selector) continue;
        if (/^children$/i.test(selector)) {
          current = current.children();
          continue;
        }
        current = applyLegadoSelector($, current, selector);
      }
      if (reverse) current = $(current.toArray().reverse());
      if (current.length > 0) return current;
    } catch {
      continue;
    }
  }
  return cheerio.load('')('');
}


function selectXPath($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, rule: string): { nodes: cheerio.Cheerio<any>; attr: string; value?: string } {
  const expr = rule.trim().replace(/^@XPath:/i, '');
  try {
    const html = $.html(root);
    const doc = new DOMParser({ errorHandler: () => undefined }).parseFromString(html, 'text/html');
    const selected = xpath.select(expr, doc as any) as any;
    const list = Array.isArray(selected) ? selected : [selected];
    const values = list.map((node) => {
      if (node === undefined || node === null) return '';
      if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
      if (node.nodeType === 2) return node.nodeValue || '';
      if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || '';
      return node.textContent || '';
    }).filter(Boolean);
    if (values.length > 0) return { nodes: root, attr: '', value: values.join('\n') };
  } catch {
    // fallback below
  }

  let fallbackExpr = expr;
  let attr = '';
  const attrMatch = fallbackExpr.match(/\/@([A-Za-z0-9_-]+)$/);
  if (attrMatch) {
    attr = attrMatch[1];
    fallbackExpr = fallbackExpr.slice(0, attrMatch.index);
  } else if (/\/text\(\)$/.test(fallbackExpr)) {
    attr = 'text';
    fallbackExpr = fallbackExpr.replace(/\/text\(\)$/, '');
  }
  const parts = fallbackExpr.split('/').filter(Boolean).map((part) => {
    const match = part.match(/^([A-Za-z0-9_*.-]+)(?:\[@([A-Za-z0-9_-]+)=['"]([^'"]+)['"]\])?(?:\[(\d+)\])?$/);
    if (!match) return '';
    const tag = match[1] === '*' ? '*' : match[1];
    const filter = match[2] ? `[${match[2]}="${match[3]}"]` : '';
    const index = match[4] ? `:nth-of-type(${match[4]})` : '';
    return `${tag}${filter}${index}`;
  }).filter(Boolean);
  return { nodes: parts.length ? root.find(parts.join(' ')) : root, attr };
}

function readValue($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, rule?: string, baseUrl?: string, jsContext?: Record<string, any>): string {
  for (const alternative of splitAlternatives(rule)) {
    const templateKind = alternative.match(/\{\{\s*@@([\s\S]*?)\}\}/);
    if (templateKind) {
      const value = alternative.replace(/\{\{\s*@@([\s\S]*?)\}\}/g, (_, innerRule) => readValue($, root, String(innerRule).trim(), baseUrl, jsContext));
      if (value) return value;
      continue;
    }
    if (alternative.includes('{{baseUrl}}')) {
      const { base, filters } = splitRuleFilters(alternative);
      const value = applyRuleFilters(base.replace(/\{\{baseUrl\}\}/g, baseUrl || ''), filters);
      if (value) return value;
      continue;
    }
    if (isJsRuleString(alternative)) {
      const transformed = evaluateJsRuleString(alternative, { ...(jsContext || {}), result: $.html(root), src: $.html(root), baseUrl });
      if (transformed) return /^(?:https?:)?\/\//i.test(transformed) || transformed.startsWith('/') ? normalizeUrl(baseUrl || '', transformed) : transformed;
      continue;
    }
    const jsIndex = alternative.indexOf('@js:');
    if (jsIndex > 0) {
      const selectorRule = alternative.slice(0, jsIndex).trim();
      const jsRule = alternative.slice(jsIndex).trim();
      const selected = readValue($, root, selectorRule, baseUrl, jsContext);
      const transformed = runJsSnippet(jsRule, { ...(jsContext || {}), result: selected, src: selected, baseUrl });
      if (transformed) {
        if (/,(\s*)\{/.test(transformed)) return transformed;
        return /^(?:https?:)?\/\//i.test(transformed) || transformed.startsWith('/') ? normalizeUrl(baseUrl || '', transformed) : transformed;
      }
      if (selected) return selected;
      continue;
    }
    const normalized = stripFilters(alternative);
    const getMatch = normalized.match(/^@get:\s*\{\s*([A-Za-z0-9_$-]+)\s*\}$/);
    if (getMatch) {
      const value = jsonPrimitiveToString(variableStore.get(getMatch[1]));
      if (value) return value;
      continue;
    }
    if (/^@?XPath:/i.test(normalized) || normalized.startsWith('//')) {
      const { nodes, attr, value: xpathValue } = selectXPath($, root, normalized);
      const node = nodes.first();
      let value = xpathValue !== undefined ? xpathValue : attr === 'text' || !attr ? node.text() : node.attr(attr) || '';
      value = he.decode(value || '').replace(/\u00a0/g, ' ').trim();
      value = applyRuleFilters(value, splitRuleFilters(alternative).filters);
      if (value) return value;
      continue;
    }
    const steps = normalized.split(/&&|@css:/).map((item) => item.trim()).filter(Boolean);
    let current = root;
    let attr = '';
    for (const rawStep of steps) {
      const parsed = parseStep(rawStep);
      if (parsed.selector) {
        if (/^children$/i.test(parsed.selector)) current = current.children();
        else {
          current = applyLegadoSelector($, current, parsed.selector);
        }
      }
      if (parsed.attr) attr = parsed.attr;
    }
    if (current.length === 0 && steps.length === 1) {
      const parsed = parseStep(steps[0]);
      if (!parsed.selector && parsed.attr) current = root;
    }
    const node = current.first();
    let value = '';
    const normalizedAttr = attr.toLowerCase();
    if (!attr || normalizedAttr === 'text' || normalizedAttr === 'textnodes') value = node.text();
    else if (normalizedAttr === 'owntext') value = node.clone().children().remove().end().text();
    else if (normalizedAttr === 'all') value = current.toArray().map((el) => $(el).text()).join('\n');
    else if (normalizedAttr === 'html') value = node.html() || '';
    else value = node.attr(attr) || '';
    value = he.decode(value || '').replace(/\u00a0/g, ' ').trim();
    if ((normalizedAttr === 'href' || normalizedAttr === 'src') && value && baseUrl) value = normalizeUrl(baseUrl, value);
    value = applyRuleFilters(value, splitRuleFilters(alternative).filters);
    value = applyPutGetRules(alternative, value);
    if (value) return value;
  }
  return '';
}

function readValues($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, rule?: string, baseUrl?: string): string[] {
  for (const alternative of splitAlternatives(rule)) {
    const normalized = stripFilters(alternative);
    const steps = normalized.split(/&&|@css:/).map((item) => item.trim()).filter(Boolean);
    let current = root;
    let attr = '';
    for (const rawStep of steps) {
      const parsed = parseStep(rawStep);
      if (parsed.selector) {
        if (/^children$/i.test(parsed.selector)) current = current.children();
        else {
          current = applyLegadoSelector($, current, parsed.selector);
        }
      }
      if (parsed.attr) attr = parsed.attr;
    }
    if (current.length === 0 && steps.length === 1) {
      const parsed = parseStep(steps[0]);
      if (!parsed.selector && parsed.attr) current = root;
    }
    const normalizedAttr = attr.toLowerCase();
    const values = current.toArray().map((element) => {
      const node = $(element);
      let value = '';
      if (!attr || normalizedAttr === 'text' || normalizedAttr === 'textnodes') value = node.text();
      else if (normalizedAttr === 'owntext') value = node.clone().children().remove().end().text();
      else if (normalizedAttr === 'all') value = node.text();
      else if (normalizedAttr === 'html') value = node.html() || '';
      else value = node.attr(attr) || '';
      value = he.decode(value || '').replace(/\u00a0/g, ' ').trim();
      if ((normalizedAttr === 'href' || normalizedAttr === 'src' || normalizedAttr === 'data-original') && value && baseUrl) value = normalizeUrl(baseUrl, value);
      return value;
    }).filter(Boolean);
    if (values.length > 0) return values;
  }
  return [];
}

function applyBookInfoInit($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, initRule?: string, baseUrl?: string) {
  const putMatch = (initRule || '').match(/@put:\s*\{([\s\S]*)\}\s*$/);
  if (!putMatch) return;
  const body = putMatch[1];
  const entryRegex = /([A-Za-z0-9_$-]+)\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(body)) !== null) {
    const key = match[1];
    const selector = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    variableStore.set(key, readValue($, root, selector, baseUrl));
  }
}

function applyContentJsRule(value: string, jsRule: string): string {
  const encryptedParams = value.match(/params\s*=\s*'([^']+)'/)?.[1];
  if (encryptedParams) {
    try {
      const encrypted = Buffer.from(encryptedParams, 'base64');
      const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('5V&RoR%Jf@pJPydF'), encrypted.subarray(0, 16));
      const decoded = Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]).toString('utf8');
      const data = JSON.parse(decoded);
      const images = Array.isArray(data?.chapter_images) ? data.chapter_images : [];
      const imageBase = data?.chapter_domain || data?.images_domain || data?.cdnurl || 'https://six.mhpic.net';
      if (images.length > 0) {
        return images
          .map((src: string) => normalizeUrl(imageBase, String(src || '')))
          .filter(Boolean)
          .map((src: string) => `<img src="${src}" style="max-width:100%; display:block;" referrerpolicy="no-referrer">`)
          .join('\n');
      }
    } catch {
      // fallback to generic JS execution below
    }
  }
  if (/window\.comicInfo/.test(value)) {
    try {
      const match = value.match(/window\.comicInfo\s*=\s*(.*?)(?:,window\.hideguide|;|<\/script>)/);
      if (match?.[1]) {
        const comicInfo = new vm.Script(`(${match[1]})`).runInNewContext({}, { timeout: 1000 });
        const images = comicInfo?.current_chapter?.chapter_img_list;
        if (Array.isArray(images)) {
          return images
            .map((src) => String(src || '').replace(/^\/\//, 'https://'))
            .filter(Boolean)
            .map((src) => `<img src="${src}" style="max-width:100%; display:block;" referrerpolicy="no-referrer">`)
            .join('\n');
        }
      }
    } catch {
      // fallback to generic JS execution below
    }
  }
  if (/result\.split\(["']\\n["']\)/.test(jsRule)) {
    return value
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((src) => `<img src="${src}" style="max-width:100%; display:block;" referrerpolicy="no-referrer">`)
      .join('');
  }
  return runJsSnippet(jsRule, { result: value, src: value }) || value;
}

function contentFromRule(raw: string, rule?: string, baseUrl?: string): string {
  const json = parseJsonMaybe(raw);
  if (json && (ruleIsJson(rule) || isJsRuleString(rule))) {
    return readJsonRule(json, rule, undefined, baseUrl);
  }
  const rawRule = rule || '';
  const blockJs = rawRule.trim().match(/^<js>([\s\S]*?)<\/js>$/i);
  const jsIndex = rawRule.indexOf('@js:');
  const selectorRule = blockJs ? '' : jsIndex >= 0 ? rawRule.slice(0, jsIndex).trim() : rawRule;
  const jsRule = blockJs ? blockJs[1].trim() : jsIndex >= 0 ? rawRule.slice(jsIndex + 4).trim() : '';
  const $ = cheerio.load(raw);
  if (jsRule) {
    const values = selectorRule ? readValues($, $.root(), selectorRule, baseUrl) : [];
    const value = selectorRule ? (values.length > 0 ? values.join('\n') : readValue($, $.root(), selectorRule, baseUrl)) : raw;
    return applyContentJsRule(value, jsRule);
  }
  return readValue($, $.root(), selectorRule, baseUrl);
}

function chapterContentFromRule(raw: string, rule?: string, baseUrl?: string): string {
  const json = parseJsonMaybe(raw);
  if (json && (ruleIsJson(rule) || isJsRuleString(rule))) {
    return readJsonRule(json, rule, undefined, baseUrl);
  }

  const rawRule = rule || '';
  const blockJs = rawRule.trim().match(/^<js>([\s\S]*?)<\/js>$/i);
  const jsIndex = rawRule.indexOf('@js:');
  if (blockJs || jsIndex >= 0) return contentFromRule(raw, rule, baseUrl);

  const $ = cheerio.load(raw);
  const values = readValues($, $.root(), rawRule, baseUrl);
  if (values.length > 0) return values.join('\n');
  return readValue($, $.root(), rawRule, baseUrl);
}

function cleanContent(value: string) {
  const decoded = he.decode(value || '').trim();
  if (/<img\b/i.test(decoded)) return decoded;
  return decoded
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n');
}

function chapterPageStem(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/_\d+(?=\.html?$)/i, '');
    return parsed.toString();
  } catch {
    return url.replace(/_\d+(?=\.html?(?:[?#]|$))/i, '');
  }
}

function proxyChapterImages(content: string, source: BookSource) {
  if (!/<img\b/i.test(content)) return content;
  const rule = source.legado;
  if (rule?.bookSourceType !== 2 && source.legado?.bookSourceType !== 2) return content;
  return content.replace(/<img\b([^>]*?)\bsrc=(['"])(.*?)\2([^>]*)>/gi, (match, before, quote, rawSrc, after) => {
    if (!rawSrc || rawSrc.startsWith('/api/books/image')) return match;
    const optionIndex = rawSrc.indexOf(',{');
    const src = optionIndex > 0 ? rawSrc.slice(0, optionIndex) : rawSrc;
    const options = optionIndex > 0 ? rawSrc.slice(optionIndex + 1) : '';
    const proxied = `/api/books/image?sourceId=${encodeURIComponent(source.id)}&url=${encodeURIComponent(src)}${options ? `&options=${encodeURIComponent(options)}` : ''}`;
    return `<img${before}src=${quote}${proxied}${quote}${after}>`;
  });
}

async function resolveLegadoConfig(): Promise<ResolvedLegadoConfig> {
  let enabled = process.env.OPDS_ENABLED === 'true' || process.env.LEGADO_ENABLED === 'true';
  let sources: BookSource[] = [];
  const cacheTTL = Number(process.env.LEGADO_CACHE_TTL_MS || process.env.OPDS_CACHE_TTL_MS || 10 * 60 * 1000);

  const envJson = process.env.LEGADO_SOURCES_JSON;
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson);
      sources = normalizeImportedSources(parsed);
    } catch { /* Invalid environment JSON leaves the source list empty. */ }
  }

  try {
    const config = await getConfig();
    if (config.OPDSConfig) {
      enabled = config.OPDSConfig.Enabled ?? enabled;
      const subscriptionSources = await legadoSubscriptionStore.getSourcesForSubscriptions(config.OPDSConfig.LegadoSubscriptions || []);
      sources = [...sources, ...subscriptionSources];
    }
  } catch { /* Keep the environment settings if stored configuration is unavailable. */ }

  return { enabled, cacheTTL, sources: sources.filter((source) => !!source.url && source.enabled !== false) };
}

export function normalizeImportedSources(input: unknown): BookSource[] {
  const list = Array.isArray(input) ? input : [input];
  return list
    .filter((item): item is LegadoBookSourceRule => !!item && typeof item === 'object')
    .map((rule, index) => {
      const name = rule.bookSourceName || `Legado 书源 ${index + 1}`;
      const url = rule.bookSourceUrl || '';
      return {
        id: `legado_${stableId(`${name}|${url}|${index}`)}`,
        name,
        type: 'legado' as const,
        url,
        enabled: rule.enabled !== false,
        authMode: 'none' as const,
        preferFormat: ['epub' as const],
        language: '',
        legado: rule,
      };
    })
    .filter((source) => !!source.url)
    .map((source) => resolveLegadoSource(source));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitUrlOptions(input: string): RequestOptions {
  const raw = input.trim();
  const comma = raw.indexOf(',');
  if (comma <= 0) return { url: raw };
  const candidate = raw.slice(comma + 1).trim();
  if (!candidate.startsWith('{')) return { url: raw };
  try {
    const options = JSON.parse(candidate);
    return {
      url: raw.slice(0, comma).trim(),
      method: options.method,
      body: options.body,
      headers: options.headers && typeof options.headers === 'object' ? options.headers : undefined,
      charset: options.charset,
      retry: Number.isFinite(Number(options.retry)) ? Number(options.retry) : undefined,
    };
  } catch {
    try {
      const options = JSON.parse(candidate.replace(/'/g, '"'));
      return {
        url: raw.slice(0, comma).trim(),
        method: options.method,
        body: options.body,
        headers: options.headers && typeof options.headers === 'object' ? options.headers : undefined,
        charset: options.charset,
        retry: Number.isFinite(Number(options.retry)) ? Number(options.retry) : undefined,
      };
    } catch {
      return { url: raw.slice(0, comma).trim() };
    }
  }
}

function getCookieHeader(sourceId: string) {
  return cookieJar.get(sourceId) || '';
}

function mergeSetCookie(sourceId: string, setCookie: string | null) {
  if (!setCookie) return;
  const current = new Map<string, string>();
  (cookieJar.get(sourceId) || '').split(/;\s*/).filter(Boolean).forEach((item) => {
    const idx = item.indexOf('=');
    if (idx > 0) current.set(item.slice(0, idx), item.slice(idx + 1));
  });
  setCookie.split(/,(?=\s*[^;,]+=)/).forEach((cookie) => {
    const pair = cookie.split(';')[0]?.trim();
    const idx = pair?.indexOf('=') ?? -1;
    if (idx > 0) current.set(pair.slice(0, idx), pair.slice(idx + 1));
  });
  cookieJar.set(sourceId, Array.from(current.entries()).map(([key, value]) => `${key}=${value}`).join('; '));
}

async function fetchText(source: BookSource, url: string): Promise<string> {
  if (!url?.trim()) throw new Error('书源请求地址为空');
  const request = splitUrlOptions(url);
  const safe = await validateProxyUrlServerSide(request.url);
  if (!safe) throw new Error(`书源地址未通过安全校验: ${request.url}`);
  const cacheKey = `text|${source.id}|${request.method || 'GET'}|${request.url}|${request.body || ''}`;
  const cached = textCache.get(cacheKey);
  const { cacheTTL } = await resolveLegadoConfig();
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  let lastError: unknown;
  const maxAttempts = Math.max(1, (request.retry ?? 2) + 1);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        ...(buildHeaders(source) as Record<string, string>),
        ...(request.headers || {}),
      };
      const cookie = getCookieHeader(source.id);
      if (source.legado?.enabledCookieJar && cookie) headers.Cookie = cookie;
      const method = (request.method || (request.body ? 'POST' : 'GET')).toUpperCase();
      const response = await fetch(request.url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (source.legado?.enabledCookieJar) mergeSetCookie(source.id, response.headers.get('set-cookie'));
      if (!response.ok) throw new Error(`请求失败: ${response.status}`);
      const contentLength = Number(response.headers.get('content-length') || '0');
      if (contentLength > MAX_TEXT_BYTES) throw new Error('响应内容过大');
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || '';
      const charset = request.charset || contentType.match(/charset=([^;]+)/i)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      const decoderName = /gbk|gb2312|gb18030/i.test(charset || '') ? 'gb18030' : (charset || 'utf-8');
      let text: string;
      try {
        text = new TextDecoder(decoderName).decode(buffer);
      } catch {
        text = new TextDecoder('utf-8').decode(buffer);
      }
      if (text.length > MAX_TEXT_BYTES) throw new Error('响应内容过大');
      textCache.set(cacheKey, { data: text, expiresAt: Date.now() + cacheTTL });
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) await wait(300 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('请求失败');
}

async function getSourceById(sourceId: string): Promise<BookSource> {
  const config = await resolveLegadoConfig();
  const source = config.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error('未找到对应的 Legado 书源');
  return source;
}

function getRule(source: BookSource): LegadoBookSourceRule {
  if (!source.legado) throw new Error('Legado 书源缺少规则');
  return resolveLegadoRule(source.legado, source) || source.legado;
}

function makeItem(source: BookSource, partial: Partial<BookListItem> & { detailHref?: string; title?: string }): BookListItem {
  const detailHref = partial.detailHref || '';
  return {
    id: partial.id || stableId(`${source.id}|${detailHref || partial.title || Date.now()}`),
    sourceId: source.id,
    sourceName: source.name,
    title: partial.title || '未命名电子书',
    author: partial.author,
    cover: partial.cover,
    summary: partial.summary,
    tags: partial.tags,
    detailHref,
    acquisitionLinks: partial.acquisitionLinks || [],
  };
}

interface ExploreTarget {
  title: string;
  template: string;
  page: number;
}

function hasRuleBookList(rule?: LegadoRuleSearch) {
  return !!rule?.bookList?.trim();
}

function getEffectiveExploreRule(rule: LegadoBookSourceRule): LegadoRuleSearch | undefined {
  if (hasRuleBookList(rule.ruleExplore)) return rule.ruleExplore;
  if (hasRuleBookList(rule.ruleSearch)) return rule.ruleSearch;
  return undefined;
}

function hasExplore(rule: LegadoBookSourceRule) {
  return rule.enabledExplore !== false && (isJsRuleString(rule.exploreUrl) || parseExploreUrl(rule.exploreUrl).length > 0) && !!getEffectiveExploreRule(rule);
}

function parseExploreUrl(exploreUrl?: string): Array<{ title: string; template: string }> {
  const raw = (exploreUrl || '').trim();
  if (!raw) return [];
  if (isJsRuleString(raw)) return [];
  const json = parseJsonMaybe(raw);
  if (Array.isArray(json)) {
    return json
      .map((item) => ({ title: jsonPrimitiveToString(item?.title), template: jsonPrimitiveToString(item?.url) || `__group__:${jsonPrimitiveToString(item?.title)}` }))
      .filter((item) => !!item.title);
  }
  return raw
    .split(/&&|\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf('::');
      if (index >= 0) return { title: item.slice(0, index).trim(), template: item.slice(index + 2).trim() };
      return { title: item, template: item };
    })
    .filter((item) => !!item.template);
}

function encodeExploreTarget(target: ExploreTarget) {
  return `legado-explore:${Buffer.from(JSON.stringify(target), 'utf8').toString('base64url')}`;
}

function decodeExploreTarget(href?: string): ExploreTarget | null {
  if (!href?.startsWith('legado-explore:')) return null;
  try {
    const raw = Buffer.from(href.slice('legado-explore:'.length), 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.template) return null;
    return { title: parsed.title || '分类', template: parsed.template, page: Number(parsed.page || 1) || 1 };
  } catch {
    return null;
  }
}

function buildExploreTargetUrl(source: BookSource, target: ExploreTarget) {
  return buildUrlFromTemplate(target.template, source, undefined, target.page);
}

async function resolveExploreCategories(source: BookSource, rule: LegadoBookSourceRule): Promise<Array<{ title: string; template: string }>> {
  const raw = (rule.exploreUrl || '').trim();
  if (!isJsRuleString(raw)) return parseExploreUrl(raw);

  const jsValue = runJsSnippetRaw(raw, { baseUrl: sourceBase(source), source: rule });
  const parsed = Array.isArray(jsValue) ? jsValue : typeof jsValue === 'string' ? parseJsonMaybe(jsValue) : null;
  if (Array.isArray(parsed)) {
    const categories = parsed
      .map((item) => ({ title: jsonPrimitiveToString(item?.title), template: jsonPrimitiveToString(item?.url) || `__group__:${jsonPrimitiveToString(item?.title)}` }))
      .filter((item) => !!item.title);
    if (categories.length > 0) return categories;
  }

  try {
    const html = await fetchText(source, sourceBase(source));
    const $ = cheerio.load(html);
    const categories = $('a[href^="/list"]').toArray().map((el) => {
      const title = $(el).text().trim();
      const href = ($(el).attr('href') || '').replace(/\/$/, '-{{page}}/');
      return title && href ? { title, template: href } : null;
    }).filter(Boolean) as Array<{ title: string; template: string }>;
    if (categories.length > 0) return [{ title: '全部分类', template: '__group__:全部分类' }, ...categories];
  } catch {
    // 动态分类首页被源站拦截时，至少不要把 @js 当成分类项显示。
  }
  return [];
}

export class LegadoClient {
  async getSources(): Promise<BookSource[]> {
    const config = await resolveLegadoConfig();
    if (!config.enabled) return [];
    return config.sources.map((source) => {
      const resolved = resolveLegadoSource(source);
      return {
        ...resolved,
        capabilities: {
          searchSupported: !!resolved.legado?.searchUrl,
          catalogSupported: hasExplore(resolved.legado || {}),
          searchMode: resolved.legado?.searchUrl ? 'legado' : 'disabled',
          catalogMode: hasExplore(resolved.legado || {}) ? 'legado' : 'disabled',
          acquisitionTypes: ['application/x-legado-chapters+json'],
          lastCheckedAt: Date.now(),
        },
      };
    });
  }

  async getSearchSources(sourceId?: string): Promise<BookSource[]> {
    return sourceId ? [await getSourceById(sourceId)] : (await resolveLegadoConfig()).sources;
  }

  async searchBooksSource(q: string, source: BookSource): Promise<{ source: BookSource; results: BookListItem[] }> {
    const rule = getRule(source);
    if (!rule.searchUrl || !rule.ruleSearch?.bookList) throw new Error('该 Legado 书源不支持搜索');
    const cacheKey = `search|${source.id}|${q}`;
    const { cacheTTL } = await resolveLegadoConfig();
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { source, results: cached.data };

    const results: BookListItem[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= DEFAULT_LEGADO_SEARCH_PAGES; page += 1) {
      const targetUrl = buildUrlFromTemplate(rule.searchUrl, source, q, page);
      const html = await fetchText(source, targetUrl);
      applyRuleJsBlocks(html, rule.ruleSearch.bookList);
      if (page === 1 && rule.ruleSearch.checkKeyWord && !html.includes(rule.ruleSearch.checkKeyWord) && !html.includes(q)) {
        throw new Error('搜索结果校验失败');
      }
      let pageCount = 0;
      const json = parseJsonMaybe(html);
      const searchBookListRule = stripRuleJsBlocks(rule.ruleSearch.bookList);
      if (json && ruleIsJson(searchBookListRule)) {
        const items = selectJsonItems(json, searchBookListRule);
        pageCount = items.length;
        items.forEach((item) => {
          const detailHref = readJsonRule(item, rule.ruleSearch?.bookUrl, source, targetUrl);
          const title = readJsonRule(item, rule.ruleSearch?.name, source, targetUrl);
          if (!title && !detailHref) return;
          const cover = readJsonRule(item, rule.ruleSearch?.coverUrl, source, targetUrl);
          const itemId = jsonPrimitiveToString(item?.id) || undefined;
          const dedupeKey = itemId || detailHref || `${title}|${cover}`;
          if (dedupeKey && seen.has(dedupeKey)) return;
          if (dedupeKey) seen.add(dedupeKey);
          results.push(makeItem(source, {
            id: itemId,
            title,
            author: readJsonRule(item, rule.ruleSearch?.author, source, targetUrl),
            summary: readJsonRule(item, rule.ruleSearch?.intro, source, targetUrl),
            cover: cover || undefined,
            detailHref,
            tags: readJsonRule(item, rule.ruleSearch?.kind, source, targetUrl).split(/[,，\s]+/).filter(Boolean),
          }));
        });
      } else if (searchBookListRule.trim().startsWith(':')) {
        const items = readAllInOneList(html, searchBookListRule);
        pageCount = items.length;
        items.forEach((item) => {
          const detailHref = readRegexItem(item, rule.ruleSearch?.bookUrl, targetUrl);
          const title = readRegexItem(item, rule.ruleSearch?.name, targetUrl);
          if (!title && !detailHref) return;
          const cover = readRegexItem(item, rule.ruleSearch?.coverUrl, targetUrl);
          const dedupeKey = detailHref || `${title}|${cover}`;
          if (dedupeKey && seen.has(dedupeKey)) return;
          if (dedupeKey) seen.add(dedupeKey);
          results.push(makeItem(source, {
            id: detailHref || undefined,
            title,
            author: readRegexItem(item, rule.ruleSearch?.author, targetUrl),
            summary: readRegexItem(item, rule.ruleSearch?.intro, targetUrl),
            cover: cover || undefined,
            detailHref,
            tags: readRegexItem(item, rule.ruleSearch?.kind, targetUrl).split(/[,，\s]+/).filter(Boolean),
          }));
        });
      } else {
        const $ = cheerio.load(html);
        const items = selectElements($, $.root(), searchBookListRule);
        pageCount = items.length;
        items.each((_, element) => {
          const root = $(element);
          const detailHref = readValue($, root, rule.ruleSearch?.bookUrl, targetUrl, { source: rule });
          const title = readValue($, root, rule.ruleSearch?.name, targetUrl);
          if (!title && !detailHref) return;
          const cover = readValue($, root, rule.ruleSearch?.coverUrl, targetUrl);
          const dedupeKey = detailHref || `${title}|${cover}`;
          if (dedupeKey && seen.has(dedupeKey)) return;
          if (dedupeKey) seen.add(dedupeKey);
          results.push(makeItem(source, {
            id: detailHref || undefined,
            title,
            author: readValue($, root, rule.ruleSearch?.author, targetUrl),
            summary: readValue($, root, rule.ruleSearch?.intro, targetUrl),
            cover: cover || undefined,
            detailHref,
            tags: readValue($, root, rule.ruleSearch?.kind, targetUrl).split(/[,，\s]+/).filter(Boolean),
          }));
        });
      }
      if (pageCount === 0) break;
    }
    searchCache.set(cacheKey, { data: results, expiresAt: Date.now() + cacheTTL });
    return { source, results };
  }

  async searchBooks(q: string, sourceId?: string): Promise<BookSearchResult> {
    const sources = await this.getSearchSources(sourceId);
    const results: BookListItem[] = [];
    const failedSources: BookSearchFailure[] = [];
    await Promise.all(sources.map(async (source) => {
      try {
        const sourceResult = await this.searchBooksSource(q, source);
        results.push(...sourceResult.results);
      } catch (error) {
        failedSources.push({ sourceId: source.id, sourceName: source.name, error: (error as Error).message });
      }
    }));
    return { results, failedSources };
  }

  async getCatalog(sourceId: string, href?: string): Promise<BookCatalogResult> {
    const source = await getSourceById(sourceId);
    const rule = getRule(source);
    if (!hasExplore(rule)) {
      return { sourceId: source.id, sourceName: source.name, title: source.name, href: href || source.url, entries: [], navigation: [] };
    }

    const categories = await resolveExploreCategories(source, rule);
    const target = decodeExploreTarget(href) || null;
    const navigation = categories.map((item) => ({
      title: item.title,
      href: item.template.startsWith('__group__:') ? '' : encodeExploreTarget({ title: item.title, template: item.template, page: 1 }),
      rel: item.template.startsWith('__group__:') ? 'legado:group' : 'legado:explore',
      type: 'application/x-legado-explore',
    }));

    if (!target) {
      return { sourceId: source.id, sourceName: source.name, title: source.name, subtitle: '请选择分类', href: href || source.url, entries: [], navigation };
    }

    if (target.template.startsWith('__group__:')) {
      return { sourceId: source.id, sourceName: source.name, title: target.title, href: href || '', entries: [], navigation };
    }
    const targetUrl = buildExploreTargetUrl(source, target);
    const html = await fetchText(source, targetUrl);
    const exploreRule = getEffectiveExploreRule(rule);
    const entries: BookListItem[] = [];
    let pageCount = 0;
    const json = parseJsonMaybe(html);
    if (json && ruleIsJson(exploreRule?.bookList)) {
      const items = selectJsonItems(json, exploreRule?.bookList);
      pageCount = items.length;
      items.forEach((item) => {
        const detailHref = readJsonRule(item, exploreRule?.bookUrl, source, targetUrl);
        const title = readJsonRule(item, exploreRule?.name, source, targetUrl);
        if (!title && !detailHref) return;
        const cover = readJsonRule(item, exploreRule?.coverUrl, source, targetUrl);
        entries.push(makeItem(source, {
          id: jsonPrimitiveToString(item?.id) || detailHref || undefined,
          title,
          author: readJsonRule(item, exploreRule?.author, source, targetUrl),
          summary: readJsonRule(item, exploreRule?.intro, source, targetUrl),
          cover: cover || undefined,
          detailHref,
          tags: readJsonRule(item, exploreRule?.kind, source, targetUrl).split(/[,，\s]+/).filter(Boolean),
        }));
      });
    } else {
      const $ = cheerio.load(html);
      const items = selectElements($, $.root(), exploreRule?.bookList);
      pageCount = items.length;
      items.each((_, element) => {
        const root = $(element);
        const detailHref = readValue($, root, exploreRule?.bookUrl, targetUrl);
        const title = readValue($, root, exploreRule?.name, targetUrl);
        if (!title && !detailHref) return;
        const cover = readValue($, root, exploreRule?.coverUrl, targetUrl);
        entries.push(makeItem(source, {
          id: detailHref || undefined,
          title,
          author: readValue($, root, exploreRule?.author, targetUrl),
          summary: readValue($, root, exploreRule?.intro, targetUrl),
          cover: cover || undefined,
          detailHref,
          tags: readValue($, root, exploreRule?.kind, targetUrl).split(/[,，\s]+/).filter(Boolean),
        }));
      });
    }

    return {
      sourceId: source.id,
      sourceName: source.name,
      title: target.title || source.name,
      subtitle: `第 ${target.page} 页`,
      href: href || encodeExploreTarget(target),
      entries,
      navigation,
      nextHref: pageCount > 0 ? encodeExploreTarget({ ...target, page: target.page + 1 }) : undefined,
      previousHref: target.page > 1 ? encodeExploreTarget({ ...target, page: target.page - 1 }) : undefined,
    };
  }

  async getChaptersByBookId(sourceId: string, bookId: string): Promise<BookChapter[]> {
    const source = await getSourceById(sourceId);
    const rule = getRule(source);
    const base = sourceBase(source);
    const searchBookUrlRule = rule.ruleSearch?.bookUrl || '';
    const detailHref = /^https?:\/\//i.test(bookId) || bookId.startsWith('/')
      ? normalizeUrl(base, bookId)
      : /\{\{\s*(?:\$\.id|id)\s*\}\}|\{id\}/.test(searchBookUrlRule)
        ? normalizeUrl(base, searchBookUrlRule
          .replace(/\{\{\s*\$\.id\s*\}\}/g, encodeURIComponent(bookId))
          .replace(/\{\{\s*id\s*\}\}/g, encodeURIComponent(bookId))
          .replace(/\{id\}/g, encodeURIComponent(bookId)))
        : '';
    if (!detailHref) throw new Error('该 Legado 书源无法通过 bookId 定位详情，请重新搜索后打开');
    const detail = await this.getBookDetail(sourceId, detailHref, { id: bookId, detailHref });
    const tocHref = detail.acquisitionLinks.find((item) => item.rel === 'legado:chapters' || item.type.toLowerCase().includes('legado-chapters'))?.href;
    if (!tocHref) return [];
    return this.getChapters(sourceId, tocHref);
  }

  async getBookDetail(sourceId: string, href: string, fallback?: Partial<BookDetail>): Promise<BookDetail> {
    const source = await getSourceById(sourceId);
    const rule = getRule(source);
    const detailHref = href || fallback?.detailHref || '';
    const cacheKey = `detail|${source.id}|${detailHref}`;
    const { cacheTTL } = await resolveLegadoConfig();
    const cached = detailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.data, ...(!href && fallback ? fallback : {}) };

    let detail: BookDetail | null = null;
    if (detailHref && rule.ruleBookInfo) {
      const targetUrl = rule.bookInfoUrl ? buildUrlFromTemplate(rule.bookInfoUrl, source, undefined, 1, detailHref).replace(/\{bookUrl\}/g, encodeURIComponent(detailHref)) : detailHref;
      const html = await fetchText(source, targetUrl);
      const initData = rule.bookInfoInit?.trim().startsWith(':') ? readAllInOneList(html, rule.bookInfoInit)[0] : null;
      const json = initData || parseJsonMaybe(html);
      const $ = json && initData ? null : json ? null : cheerio.load(html);
      const root = $?.root();
      if ($ && root) applyBookInfoInit($, root, (rule.ruleBookInfo as any).init || rule.bookInfoInit, targetUrl);
      const read = (itemRule?: string) => initData
        ? readRegexItem(initData, itemRule, targetUrl)
        : json
          ? readJsonRule(json, itemRule, source, targetUrl)
          : readValue($ as cheerio.CheerioAPI, root as cheerio.Cheerio<any>, itemRule, targetUrl);
      const tocUrl = read(rule.ruleBookInfo.tocUrl) || (rule.tocUrl ? buildUrlFromTemplate(rule.tocUrl, source, undefined, 1, detailHref).replace(/\{bookUrl\}/g, encodeURIComponent(detailHref)) : targetUrl);
      const cover = read(rule.ruleBookInfo.coverUrl) || fallback?.cover;
      const title = read(rule.ruleBookInfo.name) || fallback?.title || '未命名电子书';
      const chapterCountText = json
        ? jsonPrimitiveToString(readJsonPath(json, '@json:$.data.nums') ?? readJsonPath(json, '@json:$.data.chapter_nums'))
        : '';
      const chapterCount = chapterCountText ? Number(chapterCountText) : NaN;
      const hasKnownEmptyChapters = Number.isFinite(chapterCount) && chapterCount <= 0;
      const acquisitionLinks: BookAcquisitionLink[] = hasKnownEmptyChapters ? [] : [{ rel: 'legado:chapters', type: 'application/x-legado-chapters+json', href: tocUrl, title: '章节目录' }];
      detail = {
        id: fallback?.id || stableId(`${source.id}|${detailHref || title}`),
        sourceId,
        sourceName: source.name,
        title,
        author: read(rule.ruleBookInfo.author) || fallback?.author,
        cover: cover || undefined,
        summary: read(rule.ruleBookInfo.intro) || fallback?.summary,
        tags: read(rule.ruleBookInfo.kind).split(/[,，\s]+/).filter(Boolean),
        categories: read(rule.ruleBookInfo.kind).split(/[,，\s]+/).filter(Boolean),
        detailHref,
        acquisitionLinks,
        navigation: hasKnownEmptyChapters ? [] : [{ title: '目录', href: tocUrl, rel: 'legado:toc', type: 'application/x-legado-chapters+json' }],
      };
    }

    if (!detail) {
      const tocUrl = fallback?.acquisitionLinks?.[0]?.href || detailHref;
      detail = {
        id: fallback?.id || stableId(`${source.id}|${detailHref || fallback?.title || ''}`),
        sourceId,
        sourceName: source.name,
        title: fallback?.title || '未命名电子书',
        author: fallback?.author,
        cover: fallback?.cover,
        summary: fallback?.summary,
        detailHref,
        acquisitionLinks: [{ rel: 'legado:chapters', type: 'application/x-legado-chapters+json', href: tocUrl, title: '章节目录' }],
        navigation: [{ title: '目录', href: tocUrl, rel: 'legado:toc', type: 'application/x-legado-chapters+json' }],
      };
    }
    detailCache.set(cacheKey, { data: detail, expiresAt: Date.now() + cacheTTL });
    return detail;
  }

  async getChapters(sourceId: string, tocHref: string): Promise<BookChapter[]> {
    const source = await getSourceById(sourceId);
    const rule = getRule(source);
    if (!rule.ruleToc?.chapterList) throw new Error('该 Legado 书源缺少目录规则');
    const cacheKey = `toc|${source.id}|${tocHref}`;
    const { cacheTTL } = await resolveLegadoConfig();
    const cached = tocCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const targetUrl = normalizeUrl(sourceBase(source), tocHref);
    const html = await fetchText(source, targetUrl);
    const chapters: BookChapter[] = [];
    const json = parseJsonMaybe(html);
    const jsItems = evaluateJsListRule(rule.ruleToc.chapterList, { result: html, src: html, baseUrl: targetUrl, source: rule });
    if (jsItems.length > 0) {
      jsItems.forEach((item, index) => {
        const title = readJsonRule(item, rule.ruleToc?.chapterName, source, targetUrl) || `第 ${index + 1} 章`;
        const href = readJsonRule(item, rule.ruleToc?.chapterUrl, source, targetUrl)
          || fallbackChapterHrefFromItem(item, rule.ruleToc?.chapterUrl, targetUrl);
        if (!href) return;
        const normalizedHref = normalizeUrl(targetUrl, href);
        chapters.push({ id: stableId(`${source.id}|${normalizedHref}`), title, href: normalizedHref, order: index });
      });
    } else if (json && ruleIsJson(rule.ruleToc.chapterList)) {
      const items = selectJsonItems(json, rule.ruleToc.chapterList);
      items.forEach((item, index) => {
        const title = readJsonRule(item, rule.ruleToc?.chapterName, source, targetUrl) || `第 ${index + 1} 章`;
        const href = readJsonRule(item, rule.ruleToc?.chapterUrl, source, targetUrl)
          || fallbackChapterHrefFromItem(item, rule.ruleToc?.chapterUrl, targetUrl);
        if (!href) return;
        const normalizedHref = normalizeUrl(targetUrl, href);
        chapters.push({ id: stableId(`${source.id}|${normalizedHref}`), title, href: normalizedHref, order: index });
      });
    } else {
      const $ = cheerio.load(html);
      const items = selectElements($, $.root(), rule.ruleToc.chapterList);
      items.each((index, element) => {
        const root = $(element);
        const title = readValue($, root, rule.ruleToc?.chapterName, targetUrl) || `第 ${index + 1} 章`;
        const href = readValue($, root, rule.ruleToc?.chapterUrl, targetUrl) || root.attr('href') || '';
        if (!href) return;
        const normalizedHref = normalizeUrl(targetUrl, href);
        chapters.push({ id: stableId(`${source.id}|${normalizedHref}`), title, href: normalizedHref, order: index });
      });
    }
    if (rule.ruleToc.nextTocUrl) {
      let nextTocUrl = contentFromRule(html, rule.ruleToc.nextTocUrl, targetUrl);
      const visited = new Set([targetUrl]);
      for (let page = 0; page < 8 && nextTocUrl; page += 1) {
        const normalizedNext = normalizeUrl(targetUrl, nextTocUrl);
        if (!normalizedNext || visited.has(normalizedNext)) break;
        visited.add(normalizedNext);
        let nextHtml = '';
        try {
          nextHtml = await fetchText(source, normalizedNext);
        } catch {
          break;
        }
        const $next = cheerio.load(nextHtml);
        const nextItems = selectElements($next, $next.root(), rule.ruleToc.chapterList);
        nextItems.each((index, element) => {
          const root = $next(element);
          const title = readValue($next, root, rule.ruleToc?.chapterName, normalizedNext) || `第 ${chapters.length + index + 1} 章`;
          const href = readValue($next, root, rule.ruleToc?.chapterUrl, normalizedNext) || root.attr('href') || '';
          if (!href) return;
          const normalizedHref = normalizeUrl(normalizedNext, href);
          chapters.push({ id: stableId(`${source.id}|${normalizedHref}`), title, href: normalizedHref, order: chapters.length });
        });
        nextTocUrl = contentFromRule(nextHtml, rule.ruleToc.nextTocUrl, normalizedNext);
      }
    }
    tocCache.set(cacheKey, { data: chapters, expiresAt: Date.now() + cacheTTL });
    return chapters;
  }

  async getChapterContent(sourceId: string, chapterHref: string, tocHref?: string): Promise<BookChapterContent> {
    const source = await getSourceById(sourceId);
    const rule = getRule(source);
    if (!rule.ruleContent?.content) throw new Error('该 Legado 书源缺少正文规则');
    const targetUrl = normalizeUrl(sourceBase(source), chapterHref);
    const cacheKey = `chapter|${source.id}|${targetUrl}`;
    const cached = chapterCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    let pageUrl = targetUrl;
    const parts: string[] = [];
    const visited = new Set<string>();
    for (let page = 0; page < 8 && pageUrl && !visited.has(pageUrl); page += 1) {
      visited.add(pageUrl);
      const html = await fetchText(source, pageUrl);
      const part = chapterContentFromRule(html, rule.ruleContent.content, pageUrl);
      if (part) parts.push(part);
      const next = rule.ruleContent.nextContentUrl ? contentFromRule(html, rule.ruleContent.nextContentUrl, pageUrl) : '';
      const normalizedNext = next ? normalizeUrl(pageUrl, next) : '';
      if (!normalizedNext || normalizedNext === pageUrl || visited.has(normalizedNext)) break;
      if (chapterPageStem(normalizedNext) !== chapterPageStem(targetUrl)) break;
      pageUrl = normalizedNext;
    }
    const rawContent = parts.join('\\n\\n');
    const chapters = tocHref ? await this.getChapters(sourceId, tocHref).catch(() => []) : [];
    const index = chapters.findIndex((item) => item.href === targetUrl || item.href === chapterHref);
    const content: BookChapterContent = {
      id: stableId(`${source.id}|${targetUrl}`),
      title: index >= 0 ? chapters[index].title : '',
      href: targetUrl,
      content: proxyChapterImages(cleanContent(applyRuleFilters(rawContent, [
        ...(rule.ruleContent.sourceRegex ? [rule.ruleContent.sourceRegex, ''] : []),
        ...((rule.ruleContent as any).replaceRegex ? splitRuleFilters((rule.ruleContent as any).replaceRegex).filters : []),
      ])), source),
      previousHref: index > 0 ? chapters[index - 1].href : undefined,
      nextHref: index >= 0 && index + 1 < chapters.length ? chapters[index + 1].href : undefined,
    };
    chapterCache.set(cacheKey, { data: content, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return content;
  }

  async getSourceById(sourceId: string): Promise<BookSource> {
    return getSourceById(sourceId);
  }

  async detectCapabilitiesFromSource(source: BookSource): Promise<BookSourceCapabilities> {
    return {
      searchSupported: !!source.legado?.searchUrl,
      catalogSupported: hasExplore(source.legado || {}),
      searchMode: source.legado?.searchUrl ? 'legado' : 'disabled',
      catalogMode: hasExplore(source.legado || {}) ? 'legado' : 'disabled',
      acquisitionTypes: ['application/x-legado-chapters+json'],
      lastCheckedAt: Date.now(),
    };
  }
}

export const legadoClient = new LegadoClient();
