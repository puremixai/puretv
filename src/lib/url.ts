/**
 * 规范化 API Base URL：trim 并去除末尾斜杠，避免拼接路径时出现双斜杠。
 */
export function normalizeApiBaseUrl(
  url: string | undefined | null
): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}
