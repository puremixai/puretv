import { AdminConfig } from '@/lib/admin.types';
import { ALL_FEATURE_PERMISSION_KEYS } from '@/lib/feature-permissions';

export const DEFAULT_GROUP_PERMISSIONS = [...ALL_FEATURE_PERMISSION_KEYS];

export interface StandaloneSourceScript {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  version: string;
  code: string;
  createdAt: number;
  updatedAt: number;
}

export interface SiteConfig {
  SiteName: string;
  Announcement: string;
  AnnouncementDisplayMode?: 'once' | 'every';
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  DoubanProxyType: string;
  DoubanProxy: string;
  DoubanImageProxyType: string;
  DoubanImageProxy: string;
  DisableYellowFilter: boolean;
  FluidSearch: boolean;
  DanmakuSourceType?: 'builtin' | 'custom';
  DanmakuApiBase: string;
  DanmakuApiToken: string;
  DanmakuAutoLoadDefault?: boolean;
  TMDBApiKey?: string;
  TMDBProxy?: string;
  TMDBReverseProxy?: string;
  TMDBImageBaseUrl?: string;
  BangumiDataSource?: 'direct' | 'server-proxy' | 'custom-baseurl' | 'sakura';
  BangumiApiBaseUrl?: string;
  BangumiImageBaseUrl?: string;
  BangumiProxy?: string;
  LiveChartProxy?: string;
  BannerDataSource?: string;
  RecommendationDataSource?: string;
  LocalSettingsSyncMode?: 'off' | 'manual' | 'auto';
  PansouApiUrl?: string;
  PansouUsername?: string;
  PansouPassword?: string;
  PansouKeywordBlocklist?: string;
  MagnetProxy?: string;
  MagnetMikanReverseProxy?: string;
  MagnetDmhyReverseProxy?: string;
  MagnetAcgripReverseProxy?: string;
  MagnetNyaaReverseProxy?: string;
  EnableComments: boolean;
  EnableRegistration?: boolean;
  RequireRegistrationInviteCode?: boolean;
  RegistrationInviteCode?: string;
  RegistrationRequireTurnstile?: boolean;
  LoginRequireTurnstile?: boolean;
  TurnstileSiteKey?: string;
  TurnstileSecretKey?: string;
  DefaultUserTags?: string[];
  EnableOIDCLogin?: boolean;
  EnableOIDCRegistration?: boolean;
  OIDCIssuer?: string;
  OIDCAuthorizationEndpoint?: string;
  OIDCTokenEndpoint?: string;
  OIDCUserInfoEndpoint?: string;
  OIDCClientId?: string;
  OIDCClientSecret?: string;
  OIDCButtonText?: string;
  AnalyticsEnabled?: boolean;
  AnalyticsProvider?: 'umami' | 'google' | 'clarity' | 'custom';
  AnalyticsScriptUrl?: string;
  AnalyticsWebsiteId?: string;
  AnalyticsCustomScript?: string;
}

export interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  from: 'config' | 'custom';
  proxyMode?: boolean;
  weight?: number;
  special?: boolean;
}

export interface LiveDataSource {
  name: string;
  key: string;
  url: string;
  ua?: string;
  epg?: string;
  channelNumber?: number;
  disabled?: boolean;
  from: 'config' | 'custom';
  proxyMode?: 'full' | 'm3u8-only' | 'direct'; // 代理模式
}

export interface CustomCategory {
  name?: string;
  type: 'movie' | 'tv';
  query: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

export interface CollapsibleTabProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  isParent?: boolean;
}

export interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
  usersV2: Array<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    banned: boolean;
    tags?: string[];
    oidcSub?: string;
    enabledApis?: string[];
    created_at: number;
  }> | null;
  userPage: number;
  userTotalPages: number;
  userTotal: number;
  fetchUsersV2: (page: number, search?: string) => Promise<void>;
  userListLoading: boolean;
  userSearch: string;
  setUserSearch: (value: string) => void;
}
