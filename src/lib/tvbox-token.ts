import { randomBytes } from 'crypto';

/**
 * 生成TVBox订阅token
 * 使用crypto生成32位随机hex字符串
 */
export function generateTvboxToken(): string {
  return randomBytes(16).toString('hex');
}
