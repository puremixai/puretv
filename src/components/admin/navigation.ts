import {
  BookMarked,
  BookOpen,
  Bot,
  Cat,
  Cloud,
  Database,
  FileText,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Mail,
  Music,
  Palette,
  Send,
  Settings,
  Shield,
  SlidersHorizontal,
  Tv,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';

export const adminSections = [
  {
    id: 'overview',
    title: '工作台',
    group: '概览',
    icon: LayoutDashboard,
    description: '常用操作和站点配置状态。',
    keywords: '首页 总览 dashboard',
  },
  {
    id: 'configFile',
    title: '配置订阅',
    group: '内容管理',
    icon: FileText,
    description: '管理订阅地址、更新周期与配置历史，预览后保存应用。',
    keywords: '配置文件 url JSON Base58 回滚 历史',
    ownerOnly: true,
  },
  {
    id: 'videoSource',
    title: '视频源',
    group: '内容管理',
    icon: Video,
    description: '搜索、筛选和批量管理视频源，检查可用性与播放质量。',
    keywords: '接口 API 权重 健康 检测',
  },
  {
    id: 'liveSource',
    title: '电视直播',
    group: '内容管理',
    icon: Tv,
    description: '管理电视频道、节目单和直播代理。',
    keywords: 'IPTV m3u EPG 直播源',
  },
  {
    id: 'webLive',
    title: '网络直播',
    group: '内容管理',
    icon: Globe,
    description: '配置网络直播平台与直播间。',
    keywords: '直播间 房间',
  },
  {
    id: 'categoryConfig',
    title: '内容分类',
    group: '内容管理',
    icon: FolderOpen,
    description: '调整站点分类与内容展示顺序。',
    keywords: '电影 剧集 分类配置',
  },
  {
    id: 'movieRequests',
    title: '求片管理',
    group: '内容管理',
    icon: Video,
    description: '查看用户求片，管理处理状态与提醒。',
    keywords: '申请 请求',
  },
  {
    id: 'animeSubscription',
    title: '追番订阅',
    group: '内容管理',
    icon: Cat,
    description: '管理追番任务、更新检查与下载。',
    keywords: '动漫 RSS 自动下载',
  },
  {
    id: 'userConfig',
    title: '用户管理',
    group: '账号与站点',
    icon: Users,
    description: '查找用户，管理权限、分组与账号状态。',
    keywords: '账号 管理员 封禁 标签',
  },
  {
    id: 'registrationConfig',
    title: '注册与登录',
    group: '账号与站点',
    icon: UserPlus,
    description: '设置注册、邀请和第三方登录。',
    keywords: 'OIDC Turnstile 验证码 注册配置',
  },
  {
    id: 'siteConfig',
    title: '站点设置',
    group: '账号与站点',
    icon: Settings,
    description: '配置站点信息、影视数据、搜索播放与统计。',
    keywords: 'TMDB 豆瓣 Bangumi 弹幕 代理 公告 缓存 站点配置',
  },
  {
    id: 'themeConfig',
    title: '外观与主题',
    group: '账号与站点',
    icon: Palette,
    description: '设置站点外观、背景与展示效果。',
    keywords: '个性化 配色 背景',
  },
  {
    id: 'openListConfig',
    title: 'OpenList',
    group: '媒体服务',
    icon: FolderOpen,
    description: '连接 OpenList 文件服务并同步媒体。',
    keywords: '私人影库 文件 索引',
  },
  {
    id: 'embyConfig',
    title: 'Emby 媒体库',
    group: '媒体服务',
    icon: Database,
    description: '连接 Emby 服务器，管理媒体库与播放选项。',
    keywords: '私人影库',
  },
  {
    id: 'xiaoyaConfig',
    title: '小雅',
    group: '媒体服务',
    icon: FolderOpen,
    description: '连接小雅资源库与元数据服务。',
    keywords: 'xiaoya 私人影库',
  },
  {
    id: 'netDiskConfig',
    title: '网盘服务',
    group: '媒体服务',
    icon: Cloud,
    description: '配置网盘连接与资源搜索。',
    keywords: '网盘配置 阿里 夸克 百度 115',
  },
  {
    id: 'musicConfig',
    title: '音乐',
    group: '媒体服务',
    icon: Music,
    description: '管理音乐功能、平台和接口。',
    keywords: '音乐配置 歌曲',
  },
  {
    id: 'suwayomiConfig',
    title: '漫画',
    group: '媒体服务',
    icon: BookOpen,
    description: '连接 Suwayomi 服务与漫画源。',
    keywords: '漫画配置 Suwayomi',
  },
  {
    id: 'opdsConfig',
    title: '电子书',
    group: '媒体服务',
    icon: BookMarked,
    description: '管理 OPDS 书库与阅读服务。',
    keywords: '电子书配置 OPDS 阅读 Legado',
  },
  {
    id: 'aiConfig',
    title: 'AI 服务',
    group: '扩展与系统',
    icon: Bot,
    description: '设置 AI 模型、问片和评论能力。',
    keywords: 'AI设定 模型 key',
  },
  {
    id: 'emailConfig',
    title: '邮件通知',
    group: '扩展与系统',
    icon: Mail,
    description: '配置邮件服务与通知。',
    keywords: '邮件配置 SMTP',
  },
  {
    id: 'telegramConfig',
    title: 'Telegram Bot',
    group: '扩展与系统',
    icon: Send,
    description: '连接 Telegram 机器人与消息通知。',
    keywords: '电报 通知 bot',
  },
  {
    id: 'customAdFilter',
    title: '广告过滤',
    group: '扩展与系统',
    icon: Shield,
    description: '管理播放广告过滤规则。',
    keywords: '自定义去广告 过滤',
  },
  {
    id: 'sourceScriptLab',
    title: '视频源脚本',
    group: '扩展与系统',
    icon: Bot,
    description: '编辑、测试和管理自定义视频源脚本。',
    keywords: '脚本 测试 执行',
  },
  {
    id: 'dataMigration',
    title: '数据迁移',
    group: '扩展与系统',
    icon: Database,
    description: '导出备份或导入已有数据。',
    keywords: '备份 导出 导入 恢复',
    ownerOnly: true,
  },
  {
    id: 'maintenance',
    title: '系统维护',
    group: '扩展与系统',
    icon: SlidersHorizontal,
    description: '重载配置缓存，或按需重置站点配置。',
    keywords: '重置 配置 缓存 重载',
    ownerOnly: true,
  },
] as const;

export type AdminSectionId = (typeof adminSections)[number]['id'];
export type AdminSection = (typeof adminSections)[number];
export function visibleAdminSections(role: 'owner' | 'admin' | null) {
  return adminSections.filter(
    (section) => role === 'owner' || !('ownerOnly' in section)
  );
}
export function filterAdminSections(
  sections: readonly AdminSection[],
  query: string
) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return sections.filter((section) =>
    terms.every((term) =>
      `${section.title} ${section.group} ${section.description} ${section.keywords}`
        .toLowerCase()
        .includes(term)
    )
  );
}
