export interface AnimeSubscription {
  id: string;
  title: string;
  /**
   * 包含关键词表达式。
   * 支持 &（且）|（或）()；无运算符时逗号为 AND（兼容旧数据）。
   * 例：喵萌奶茶屋&(简日双语|简日内嵌)
   */
  filterText: string;
  /**
   * 排除关键词表达式。
   * 支持 & | ()；无运算符时逗号为 OR（兼容旧数据）。
   * 例：先行|预告|PV
   */
  excludeText?: string;
  source: 'acgrip' | 'mikan' | 'dmhy' | 'nyaa';
  enabled: boolean;
  /**
   * 单集只下载一次：同一集匹配到多个种子时只入队一条（可选，默认 false）
   */
  onePerEpisode?: boolean;
  /**
   * 缺集重新检索：首搜若跳集（如已看到 1，结果只有 11/12），
   * 则对中间缺集按「番名 + 补零集数」再搜（可选，默认 false）
   */
  refillMissingEpisodes?: boolean;
  lastCheckTime: number;
  lastEpisode: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export type AnimeSubscriptionDownloadTool = 'aria2' | 'qBittorrent' | 'Transmission';

export interface AnimeSubscriptionConfig {
  Enabled: boolean;
  DownloadTool?: AnimeSubscriptionDownloadTool;
  Subscriptions: AnimeSubscription[];
}
