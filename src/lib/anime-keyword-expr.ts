import { logger } from '@/lib/logger';
/**
 * 追番订阅关键词表达式（纯函数，可被客户端安全引用）
 *
 * 语法（优先级：() > & > |）：
 *   expr     := or_expr
 *   or_expr  := and_expr ( '|' and_expr )*
 *   and_expr := primary ( '&' primary )*
 *   primary  := '(' expr ')' | keyword
 *
 * 兼容旧数据：字符串中不含 & | ( ) 时
 *   - mode 'and'（filter）：逗号 = AND
 *   - mode 'or'（exclude）：逗号 = OR
 *
 * 全角 ＆｜（） 会归一化为半角。
 */

export type KeywordExprMode = 'and' | 'or';

/** 判断 CMS / 分类文案是否为动漫（客户端/服务端均可） */
export function isAnimeCategoryText(
  ...parts: Array<string | undefined | null>
): boolean {
  const text = parts.filter(Boolean).join(' ');
  if (!text) return false;
  return /动画|動漫|动漫|anime|アニメ/i.test(text);
}

type ExprNode =
  | { type: 'and'; children: ExprNode[] }
  | { type: 'or'; children: ExprNode[] }
  | { type: 'kw'; value: string };

const OP_CHARS = new Set(['&', '|', '(', ')']);

/** 是否含有表达式运算符（半角或全角） */
export function hasExprOperators(text: string): boolean {
  return /[&|（）()]|＆|｜/.test(text);
}

function normalizeOps(text: string): string {
  return text
    .replace(/＆/g, '&')
    .replace(/｜/g, '|')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

function normalizeCommas(text: string): string {
  return text.replace(/，/g, ',');
}

/** 旧式逗号分隔关键词 */
export function parseCommaKeywords(text: string): string[] {
  return normalizeCommas(text)
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

type Token =
  | { kind: 'op'; value: '&' | '|' | '(' | ')' }
  | { kind: 'kw'; value: string };

function tokenize(input: string): Token[] {
  const s = normalizeOps(input);
  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    // 关键词可含空格，直到运算符为止
    let j = i;
    while (j < s.length && !OP_CHARS.has(s[j])) {
      j += 1;
    }
    const raw = s.slice(i, j).trim();
    if (raw) {
      tokens.push({ kind: 'kw', value: raw });
    }
    i = j;
  }

  return tokens;
}

class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordExprParseError';
  }
}

function parseTokens(tokens: Token[]): ExprNode {
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => {
    const t = tokens[pos];
    pos += 1;
    return t;
  };

  function parseOr(): ExprNode {
    const parts: ExprNode[] = [parseAnd()];
    while (peek()?.kind === 'op' && peek().value === '|') {
      consume();
      parts.push(parseAnd());
    }
    if (parts.length === 1) return parts[0];
    return { type: 'or', children: parts };
  }

  function parseAnd(): ExprNode {
    const parts: ExprNode[] = [parsePrimary()];
    while (peek()?.kind === 'op' && peek().value === '&') {
      consume();
      parts.push(parsePrimary());
    }
    if (parts.length === 1) return parts[0];
    return { type: 'and', children: parts };
  }

  function parsePrimary(): ExprNode {
    const t = peek();
    if (!t) {
      throw new ParseError('表达式不完整');
    }
    if (t.kind === 'op' && t.value === '(') {
      consume();
      const inner = parseOr();
      const close = consume();
      if (!close || close.kind !== 'op' || close.value !== ')') {
        throw new ParseError('缺少右括号 )');
      }
      return inner;
    }
    if (t.kind === 'kw') {
      consume();
      return { type: 'kw', value: t.value };
    }
    throw new ParseError(`意外的符号: ${t.value}`);
  }

  if (tokens.length === 0) {
    throw new ParseError('空表达式');
  }

  const root = parseOr();
  if (pos < tokens.length) {
    throw new ParseError('表达式存在多余内容');
  }
  return root;
}

function evalNode(title: string, node: ExprNode): boolean {
  switch (node.type) {
    case 'kw':
      return title.includes(node.value);
    case 'and':
      return node.children.every((c) => evalNode(title, c));
    case 'or':
      return node.children.some((c) => evalNode(title, c));
    default:
      return false;
  }
}

/**
 * 解析并匹配关键词表达式。
 * @param mode 无运算符时的逗号语义：filter 用 and，exclude 用 or
 * @returns 匹配结果；非法表达式时 match=false 且带 error
 */
export function matchKeywordExpr(
  title: string,
  exprText: string | undefined | null,
  mode: KeywordExprMode
): { match: boolean; error?: string } {
  if (exprText == null || !String(exprText).trim()) {
    // filter 空 = 全过；exclude 空 = 不排除
    return { match: mode === 'and' };
  }

  const text = String(exprText).trim();

  try {
    if (!hasExprOperators(text)) {
      const keywords = parseCommaKeywords(text);
      if (keywords.length === 0) {
        return { match: mode === 'and' };
      }
      if (mode === 'and') {
        return { match: keywords.every((k) => title.includes(k)) };
      }
      return { match: keywords.some((k) => title.includes(k)) };
    }

    const tokens = tokenize(text);
    if (tokens.length === 0) {
      return { match: mode === 'and' };
    }
    const ast = parseTokens(tokens);
    return { match: evalNode(title, ast) };
  } catch (e) {
    const message = e instanceof Error ? e.message : '表达式解析失败';
    return { match: false, error: message };
  }
}

/** 包含关键词（filter）：空=通过；非法表达式=不通过 */
export function matchesFilter(title: string, filterText: string): boolean {
  if (!filterText) return true;
  const result = matchKeywordExpr(title, filterText, 'and');
  if (result.error) {
    logger.warn(`[AnimeSubscription] 过滤表达式无效: ${result.error} | ${filterText}`);
  }
  return result.match;
}

/** 排除关键词（exclude）：空=不排除；命中=true 表示应跳过 */
export function matchesExclude(title: string, excludeText?: string): boolean {
  if (!excludeText) return false;
  const result = matchKeywordExpr(title, excludeText, 'or');
  if (result.error) {
    logger.warn(`[AnimeSubscription] 排除表达式无效: ${result.error} | ${excludeText}`);
    // 非法排除式：保守起见不排除（避免误杀全部），但已打日志
    return false;
  }
  return result.match;
}

/** 校验表达式是否可解析（供 API/UI） */
export function validateKeywordExpr(
  exprText: string | undefined | null,
  _mode: KeywordExprMode = 'and'
): { ok: boolean; error?: string } {
  if (exprText == null || !String(exprText).trim()) {
    return { ok: true };
  }
  const text = String(exprText).trim();
  if (!hasExprOperators(text)) {
    return { ok: true };
  }
  try {
    const tokens = tokenize(text);
    if (tokens.length === 0) return { ok: true };
    parseTokens(tokens);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : '表达式解析失败',
    };
  }
}

// ---------------------------------------------------------------------------
// 单集只下一次：同集择优
// ---------------------------------------------------------------------------

/** 网页友好打分：内嵌 > 内封，简日双语 > 简中 */
export function scoreTorrentTitle(title: string): number {
  let score = 0;
  if (/简日双语|简日雙語/.test(title)) score += 5;
  else if (/简日内嵌|簡日內嵌/.test(title)) score += 4;
  else if (/简中|简体|CHS|GB/i.test(title)) score += 3;
  else if (/简日/.test(title)) score += 2;

  if (/内嵌|內嵌/.test(title)) score += 4;
  else if (/内封|內封/.test(title)) score += 1;

  if (/1080/.test(title)) score += 2;
  else if (/720/.test(title)) score -= 1;

  // MP4 略优于默认（网页更友好）
  if (/MP4|mp4/.test(title)) score += 1;

  return score;
}

export interface EpisodeCandidate {
  episode: number;
  title: string;
  [key: string]: unknown;
}

/**
 * 每个集数只保留打分最高的一条（同分保留先出现的）
 */
export function pickOnePerEpisode<T extends EpisodeCandidate>(items: T[]): T[] {
  const best = new Map<number, T>();
  for (const item of items) {
    const prev = best.get(item.episode);
    if (!prev) {
      best.set(item.episode, item);
      continue;
    }
    const sNew = scoreTorrentTitle(item.title);
    const sOld = scoreTorrentTitle(prev.title);
    if (sNew > sOld) {
      best.set(item.episode, item);
    }
  }
  return Array.from(best.values()).sort((a, b) => a.episode - b.episode);
}
