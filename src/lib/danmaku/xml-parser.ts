import type { DanmakuComment } from './types';

/**
 * 解析XML格式的弹幕文件
 * @param xmlContent XML文件内容
 * @returns 弹幕评论数组
 */
export function parseXmlDanmaku(xmlContent: string): DanmakuComment[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

  const dElements = xmlDoc.getElementsByTagName('d');
  const comments: DanmakuComment[] = [];

  for (let i = 0; i < dElements.length; i++) {
    const element = dElements[i];
    const p = element.getAttribute('p');
    const text = element.textContent;

    if (p && text) {
      comments.push({
        p,
        m: text,
        cid: i,
      });
    }
  }

  return comments;
}
