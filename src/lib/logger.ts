type Level = 'debug' | 'info' | 'warn' | 'error';
const ranks = { debug: 0, info: 1, warn: 2, error: 3 };
const sensitive =
  /password|passwd|secret|token|authorization|cookie|api[_-]?key/i;
export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value instanceof Error)
    return {
      name: value.name,
      message: redactLogValue(value.message, depth + 1),
    };
  if (typeof value === 'string')
    return value
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
      .replace(
        /((?:password|passwd|secret|token|authorization|cookie|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s&"',}]+/gi,
        '$1[redacted]'
      );
  if (Array.isArray(value))
    return value.slice(0, 30).map((item) => redactLogValue(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          sensitive.test(key) ? '[redacted]' : redactLogValue(item, depth + 1),
        ])
    );
  return value;
}
function log(level: Level, args: unknown[]) {
  const configured =
    (typeof window === 'undefined'
      ? process.env.LOG_LEVEL
      : process.env.NEXT_PUBLIC_LOG_LEVEL) || 'warn';
  if (ranks[level] < (ranks[configured as Level] ?? ranks.warn)) return;
  // All app logging is filtered and redacted at this single output boundary.
  // eslint-disable-next-line no-console
  console[level](...args.map((value) => redactLogValue(value)));
}
export const logger = {
  debug: (...args: unknown[]) => log('debug', args),
  info: (...args: unknown[]) => log('info', args),
  warn: (...args: unknown[]) => log('warn', args),
  error: (...args: unknown[]) => log('error', args),
};
