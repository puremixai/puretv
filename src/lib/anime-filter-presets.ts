/**
 * 追番订阅快捷建议（字幕组单选）
 * - label：chip 只显示组名
 * - insert：选中后整段写入过滤关键词（替换，非追加）
 * 偏好：简日双语 > 简中；内嵌 > 内封（网页对 MKV/内封不友好）
 */

export interface AnimeFansubPreset {
  id: string;
  /** chip 显示的短名 */
  label: string;
  /** 选中后写入 filterText 的完整表达式 */
  insert: string;
  hint?: string;
}

/** 排除关键词快捷（同样单选替换） */
export interface AnimeExcludePreset {
  id: string;
  label: string;
  insert: string;
  hint?: string;
}

/** 字幕组快捷列表：单选，一次只选一个组 */
export const ANIME_FANSUB_PRESETS: AnimeFansubPreset[] = [
  {
    id: 'miao',
    label: '喵萌奶茶屋',
    insert: '喵萌奶茶屋&简日双语',
    hint: '简日双语优先',
  },
  {
    id: 'kitauji',
    label: '北宇治',
    insert: '北宇治&简日内嵌',
  },
  {
    id: 'lvcha',
    label: '绿茶字幕组',
    insert: '绿茶&简日内嵌',
  },
  {
    id: 'boxue',
    label: '拨雪寻春',
    insert: '拨雪寻春&简日内嵌',
  },
  {
    id: 'sandwich',
    label: '三明治摆烂组',
    insert: '三明治摆烂组&简日内嵌',
  },
  {
    id: 'sakurato',
    label: '桜都',
    insert: '桜都&简日内嵌',
  },
  {
    id: 'qianxia',
    label: '千夏',
    insert: '千夏&简日内嵌',
  },
  {
    id: 'ailian',
    label: '爱恋',
    insert: '爱恋&简日内嵌',
  },
  {
    id: 'zhushen',
    label: '诸神',
    insert: '诸神&简中',
  },
  {
    id: 'youha',
    label: '悠哈璃羽',
    insert: '悠哈璃羽&简中',
  },
  {
    id: 'jiying',
    label: '极影',
    insert: '极影&简中',
  },
  {
    id: 'wandou',
    label: '豌豆',
    insert: '豌豆&简体',
    hint: '多为简体 MP4',
  },
  {
    id: 'ani',
    label: 'ANi',
    insert: 'ANi&CHS',
    hint: '默认多为繁中，已锁 CHS',
  },
  {
    id: 'skymoon',
    label: 'Skymoon',
    insert: 'Skymoon&CHS',
  },
  {
    id: 'lilith',
    label: 'Lilith-Raws',
    insert: 'Lilith-Raws&CHS',
  },
  {
    id: 'lolihouse',
    label: 'LoliHouse',
    insert: 'LoliHouse&简繁内封',
    hint: '多为 MKV 内封，网页不友好',
  },
];

export const ANIME_EXCLUDE_PRESETS: AnimeExcludePreset[] = [
  {
    id: 'preview',
    label: '预告/PV',
    insert: '先行|预告|PV|CM|特报|预览',
  },
  {
    id: 'raw',
    label: '生肉',
    insert: '生肉|RAW|raw',
  },
  {
    id: '720',
    label: '720p',
    insert: '720',
  },
];

/**
 * 字幕组单选：
 * - 点未选中的组 → 整段替换为该 insert
 * - 再点同一组 → 清空
 */
export function applyFansubSingleSelect(
  current: string,
  preset: AnimeFansubPreset
): string {
  const cur = (current || '').trim();
  const ins = preset.insert.trim();
  if (cur === ins) return '';
  return ins;
}

/** 排除快捷单选（同上） */
export function applyExcludeSingleSelect(
  current: string,
  preset: AnimeExcludePreset
): string {
  const cur = (current || '').trim();
  const ins = preset.insert.trim();
  if (cur === ins) return '';
  return ins;
}

export function isFansubPresetActive(
  current: string,
  preset: AnimeFansubPreset
): boolean {
  return (current || '').trim() === preset.insert.trim();
}

export function isExcludePresetActive(
  current: string,
  preset: AnimeExcludePreset
): boolean {
  return (current || '').trim() === preset.insert.trim();
}
