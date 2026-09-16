/* eslint-disable no-console */

'use client';

import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

import { SiteConfig } from './types';

export const SiteConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [showEnableCommentsModal, setShowEnableCommentsModal] = useState(false);
  const [bangumiProxyScript, setBangumiProxyScript] = useState('');
  const [bangumiProxyScriptCopied, setBangumiProxyScriptCopied] =
    useState(false);
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    Announcement: '',
    AnnouncementDisplayMode: 'once',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    DoubanProxyType: 'cmliussss-cdn-tencent',
    DoubanProxy: '',
    DoubanImageProxyType: 'cmliussss-cdn-tencent',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: true,
    DanmakuSourceType: 'builtin',
    DanmakuApiBase: 'https://mtvpls-danmu.netlify.app/87654321',
    DanmakuApiToken: '87654321',
    DanmakuAutoLoadDefault: true,
    TMDBApiKey: '',
    TMDBProxy: '',
    TMDBReverseProxy: '',
    TMDBImageBaseUrl: 'https://image.tmdb.org',
    BangumiDataSource: 'direct',
    BangumiApiBaseUrl: 'https://api.bgm.tv',
    BangumiImageBaseUrl: '',
    BangumiProxy: '',
    LiveChartProxy: '',
    BannerDataSource: 'Douban',
    RecommendationDataSource: 'Mixed',
    LocalSettingsSyncMode: 'off',
    PansouApiUrl: '',
    PansouUsername: '',
    PansouPassword: '',
    PansouKeywordBlocklist: '',
    MagnetProxy: '',
    MagnetMikanReverseProxy: '',
    MagnetDmhyReverseProxy: '',
    MagnetAcgripReverseProxy: '',
    MagnetNyaaReverseProxy: '',
    EnableComments: false,
    EnableRegistration: false,
    RegistrationRequireTurnstile: false,
    LoginRequireTurnstile: false,
    TurnstileSiteKey: '',
    TurnstileSecretKey: '',
    DefaultUserTags: [],
    EnableOIDCLogin: false,
    EnableOIDCRegistration: false,
    OIDCIssuer: '',
    OIDCAuthorizationEndpoint: '',
    OIDCTokenEndpoint: '',
    OIDCUserInfoEndpoint: '',
    OIDCClientId: '',
    OIDCClientSecret: '',
    OIDCButtonText: '',
    AnalyticsEnabled: false,
    AnalyticsProvider: 'umami',
    AnalyticsScriptUrl: '',
    AnalyticsWebsiteId: '',
    AnalyticsCustomScript: '',
  });

  const siteTabs = [
    { id: 'basic', title: '基础信息' },
    { id: 'metadata', title: '影视数据' },
    { id: 'playback', title: '搜索与播放' },
    { id: 'analytics', title: '访问统计' },
  ];
  const [siteTab, setSiteTab] = useState('basic');
  const [savedSettings, setSavedSettings] = useState('');
  const siteDirty =
    !!savedSettings && JSON.stringify(siteSettings) !== savedSettings;
  useUnsavedChanges(siteDirty);
  // 豆瓣数据源相关状态
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);

  // 豆瓣数据源选项
  const doubanDataSourceOptions = [
    { value: 'direct', label: '直连（服务器直接请求豆瓣）' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];

  // 豆瓣图片代理选项
  const doubanImageProxyTypeOptions = [
    { value: 'server', label: '服务器代理（由服务器代理请求豆瓣）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
    {
      value: 'direct',
      label: '直连（浏览器直接请求豆瓣，可能需要浏览器插件才能正常显示）',
    },
    {
      value: 'img3',
      label: '豆瓣官方精品 CDN（阿里云，可能需要浏览器插件才能正常显示）',
    },
  ];

  // 获取感谢信息
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  useEffect(() => {
    fetch('/scripts/bangumi-proxy.worker.js')
      .then((response) => (response.ok ? response.text() : ''))
      .then(setBangumiProxyScript)
      .catch((error) => {
        console.error('加载 Bangumi Workers 脚本失败:', error);
      });
  }, []);

  useEffect(() => {
    if (config?.SiteConfig) {
      const nextSettings: SiteConfig = {
        ...config.SiteConfig,
        DoubanProxyType:
          config.SiteConfig.DoubanProxyType || 'cmliussss-cdn-tencent',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
        DoubanImageProxyType:
          config.SiteConfig.DoubanImageProxyType || 'cmliussss-cdn-tencent',
        DoubanImageProxy: config.SiteConfig.DoubanImageProxy || '',
        DisableYellowFilter: config.SiteConfig.DisableYellowFilter || false,
        FluidSearch: config.SiteConfig.FluidSearch ?? true,
        DanmakuSourceType: config.SiteConfig.DanmakuSourceType || 'custom',
        DanmakuApiBase:
          config.SiteConfig.DanmakuApiBase || 'http://localhost:9321',
        DanmakuApiToken: config.SiteConfig.DanmakuApiToken || '87654321',
        DanmakuAutoLoadDefault:
          config.SiteConfig.DanmakuAutoLoadDefault !== false,
        TMDBApiKey: config.SiteConfig.TMDBApiKey || '',
        TMDBProxy: config.SiteConfig.TMDBProxy || '',
        TMDBReverseProxy: config.SiteConfig.TMDBReverseProxy || '',
        TMDBImageBaseUrl:
          config.SiteConfig.TMDBImageBaseUrl || 'https://image.tmdb.org',
        BangumiDataSource: config.SiteConfig.BangumiDataSource || 'direct',
        BangumiApiBaseUrl:
          config.SiteConfig.BangumiApiBaseUrl || 'https://api.bgm.tv',
        BangumiImageBaseUrl: config.SiteConfig.BangumiImageBaseUrl || '',
        BangumiProxy: config.SiteConfig.BangumiProxy || '',
        LiveChartProxy: config.SiteConfig.LiveChartProxy || '',
        BannerDataSource: config.SiteConfig.BannerDataSource || 'Douban',
        RecommendationDataSource:
          config.SiteConfig.RecommendationDataSource || 'Mixed',
        LocalSettingsSyncMode: config.SiteConfig.LocalSettingsSyncMode || 'off',
        PansouApiUrl: config.SiteConfig.PansouApiUrl || '',
        PansouUsername: config.SiteConfig.PansouUsername || '',
        PansouPassword: config.SiteConfig.PansouPassword || '',
        PansouKeywordBlocklist: config.SiteConfig.PansouKeywordBlocklist || '',
        MagnetProxy: config.SiteConfig.MagnetProxy || '',
        MagnetMikanReverseProxy:
          config.SiteConfig.MagnetMikanReverseProxy || '',
        MagnetDmhyReverseProxy: config.SiteConfig.MagnetDmhyReverseProxy || '',
        MagnetAcgripReverseProxy:
          config.SiteConfig.MagnetAcgripReverseProxy || '',
        MagnetNyaaReverseProxy: config.SiteConfig.MagnetNyaaReverseProxy || '',
        EnableComments: config.SiteConfig.EnableComments || false,
        AnnouncementDisplayMode:
          config.SiteConfig.AnnouncementDisplayMode === 'every'
            ? 'every'
            : ('once' as const),
      };
      setSiteSettings(nextSettings);
      setSavedSettings(JSON.stringify(nextSettings));
    }
  }, [config]);

  // 点击外部区域关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  // 处理豆瓣数据源变化
  const handleDoubanDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanProxyType: value,
    }));
  };

  // 处理豆瓣图片代理变化
  const handleDoubanImageProxyChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanImageProxyType: value,
    }));
  };

  // 处理评论开关变化
  const handleCommentsToggle = (checked: boolean) => {
    if (checked) {
      // 如果要开启评论，弹出确认框
      setShowEnableCommentsModal(true);
    } else {
      // 直接关闭评论
      setSiteSettings((prev) => ({
        ...prev,
        EnableComments: false,
      }));
    }
  };

  // 确认开启评论
  const handleConfirmEnableComments = () => {
    setSiteSettings((prev) => ({
      ...prev,
      EnableComments: true,
    }));
    setShowEnableCommentsModal(false);
  };

  const handleCopyBangumiProxyScript = async () => {
    if (!bangumiProxyScript) return;
    try {
      await navigator.clipboard.writeText(bangumiProxyScript);
      setBangumiProxyScriptCopied(true);
      showSuccess('已复制 Bangumi Workers 脚本', showAlert);
      setTimeout(() => setBangumiProxyScriptCopied(false), 2000);
    } catch (error) {
      console.error('复制 Bangumi Workers 脚本失败:', error);
      showError('复制失败', showAlert);
    }
  };

  // 保存站点配置
  const handleSave = async () => {
    await withLoading('saveSiteConfig', async () => {
      try {
        const resp = await fetch('/api/admin/site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...siteSettings }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `保存失败: ${resp.status}`);
        }

        showSuccess('站点设置已保存', showAlert);
        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      <div
        className='flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800'
        role='tablist'
        aria-label='站点设置分组'
        data-admin-filter
      >
        {siteTabs.map((tab) => (
          <button
            key={tab.id}
            id={'site-tab-' + tab.id}
            type='button'
            role='tab'
            aria-selected={siteTab === tab.id}
            aria-controls={'site-panel-' + tab.id}
            tabIndex={siteTab === tab.id ? 0 : -1}
            onKeyDown={(event) => {
              const index = siteTabs.findIndex((item) => item.id === siteTab);
              let next = index;
              if (event.key === 'ArrowRight')
                next = (index + 1) % siteTabs.length;
              else if (event.key === 'ArrowLeft')
                next = (index + siteTabs.length - 1) % siteTabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = siteTabs.length - 1;
              else return;
              event.preventDefault();
              setSiteTab(siteTabs[next].id);
              document.getElementById('site-tab-' + siteTabs[next].id)?.focus();
            }}
            onClick={() => setSiteTab(tab.id)}
            className={
              siteTab === tab.id
                ? 'rounded-md bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow-xs dark:bg-slate-700 dark:text-emerald-300'
                : 'rounded-md px-4 py-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }
          >
            {tab.title}
          </button>
        ))}
      </div>
      <section
        role='tabpanel'
        id='site-panel-basic'
        aria-labelledby='site-tab-basic'
        hidden={siteTab !== 'basic'}
        className='space-y-6 max-w-4xl'
      >
        <div>
          <label
            htmlFor='site-field-1'
            className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
          >
            站点名称
          </label>
          <input
            id='site-field-1'
            type='text'
            value={siteSettings.SiteName}
            onChange={(e) =>
              setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
          />
        </div>
        <div>
          <label
            htmlFor='site-field-2'
            className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
          >
            站点公告
          </label>
          <textarea
            id='site-field-2'
            value={siteSettings.Announcement}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                Announcement: e.target.value,
              }))
            }
            rows={3}
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
          />
        </div>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            公告显示模式
          </label>
          <div className='flex gap-4'>
            <label className='inline-flex items-center gap-2 cursor-pointer'>
              <input
                type='radio'
                name='announcementDisplayMode'
                value='once'
                checked={siteSettings.AnnouncementDisplayMode !== 'every'}
                onChange={() =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    AnnouncementDisplayMode: 'once',
                  }))
                }
                className='text-green-600 focus:ring-green-500'
              />
              <span className='text-sm text-gray-700 dark:text-gray-300'>
                单次显示
              </span>
            </label>
            <label className='inline-flex items-center gap-2 cursor-pointer'>
              <input
                type='radio'
                name='announcementDisplayMode'
                value='every'
                checked={siteSettings.AnnouncementDisplayMode === 'every'}
                onChange={() =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    AnnouncementDisplayMode: 'every',
                  }))
                }
                className='text-green-600 focus:ring-green-500'
              />
              <span className='text-sm text-gray-700 dark:text-gray-300'>
                每次显示
              </span>
            </label>
          </div>
        </div>
        <div>
          <label
            htmlFor='site-field-3'
            className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
          >
            本地设置云同步
          </label>
          <select
            id='site-field-3'
            value={siteSettings.LocalSettingsSyncMode || 'off'}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                LocalSettingsSyncMode: e.target.value as
                  | 'off'
                  | 'manual'
                  | 'auto',
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
          >
            <option value='off'>关闭</option>
            <option value='manual'>手动模式</option>
            <option value='auto'>自动模式</option>
          </select>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            登录用户可把本地设置同步到云端，多设备保持一致。
            <br />
            手动模式：本地设置面板右上角出现「备份/恢复」按钮。
            <br />
            自动模式：进入网站自动拉取云端副本，打开本地设置面板时后台静默同步。
          </p>
        </div>
      </section>
      <section
        role='tabpanel'
        id='site-panel-metadata'
        aria-labelledby='site-tab-metadata'
        hidden={siteTab !== 'metadata'}
        className='space-y-6 max-w-4xl'
      >
        <div className='space-y-3'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              豆瓣数据代理
            </label>
            <div className='relative' data-dropdown='douban-datasource'>
              {/* 自定义下拉选择框 */}
              <button
                type='button'
                onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
                className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-xs hover:border-gray-400 dark:hover:border-gray-500 text-left'
              >
                {
                  doubanDataSourceOptions.find(
                    (option) => option.value === siteSettings.DoubanProxyType
                  )?.label
                }
              </button>

              {/* 下拉箭头 */}
              <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                    isDoubanDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </div>

              {/* 下拉选项列表 */}
              {isDoubanDropdownOpen && (
                <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                  {doubanDataSourceOptions.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => {
                        handleDoubanDataSourceChange(option.value);
                        setIsDoubanDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        siteSettings.DoubanProxyType === option.value
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      <span className='truncate'>{option.label}</span>
                      {siteSettings.DoubanProxyType === option.value && (
                        <Check className='w-4 h-4 text-green-600 dark:text-green-400 shrink-0 ml-2' />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              选择获取豆瓣数据的方式
            </p>

            {/* 感谢信息 */}
            {getThanksInfo(siteSettings.DoubanProxyType) && (
              <div className='mt-3'>
                <button
                  type='button'
                  onClick={() =>
                    window.open(
                      getThanksInfo(siteSettings.DoubanProxyType)!.url,
                      '_blank'
                    )
                  }
                  className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                >
                  <span className='font-medium'>
                    {getThanksInfo(siteSettings.DoubanProxyType)!.text}
                  </span>
                  <ExternalLink className='w-3.5 opacity-70' />
                </button>
              </div>
            )}
          </div>

          {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
          {siteSettings.DoubanProxyType === 'custom' && (
            <div>
              <label
                htmlFor='site-field-4'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                豆瓣代理地址
              </label>
              <input
                id='site-field-4'
                type='text'
                placeholder='例如: https://proxy.example.com/fetch?url='
                value={siteSettings.DoubanProxy}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    DoubanProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-xs hover:border-gray-400 dark:hover:border-gray-500'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                自定义代理服务器地址
              </p>
            </div>
          )}
        </div>
        <div className='space-y-3'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              豆瓣图片代理
            </label>
            <div className='relative' data-dropdown='douban-image-proxy'>
              {/* 自定义下拉选择框 */}
              <button
                type='button'
                onClick={() =>
                  setIsDoubanImageProxyDropdownOpen(
                    !isDoubanImageProxyDropdownOpen
                  )
                }
                className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-xs hover:border-gray-400 dark:hover:border-gray-500 text-left'
              >
                {
                  doubanImageProxyTypeOptions.find(
                    (option) =>
                      option.value === siteSettings.DoubanImageProxyType
                  )?.label
                }
              </button>

              {/* 下拉箭头 */}
              <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                    isDoubanImageProxyDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </div>

              {/* 下拉选项列表 */}
              {isDoubanImageProxyDropdownOpen && (
                <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                  {doubanImageProxyTypeOptions.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => {
                        handleDoubanImageProxyChange(option.value);
                        setIsDoubanImageProxyDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        siteSettings.DoubanImageProxyType === option.value
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      <span className='truncate'>{option.label}</span>
                      {siteSettings.DoubanImageProxyType === option.value && (
                        <Check className='w-4 h-4 text-green-600 dark:text-green-400 shrink-0 ml-2' />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              选择获取豆瓣图片的方式
            </p>

            {/* 感谢信息 */}
            {getThanksInfo(siteSettings.DoubanImageProxyType) && (
              <div className='mt-3'>
                <button
                  type='button'
                  onClick={() =>
                    window.open(
                      getThanksInfo(siteSettings.DoubanImageProxyType)!.url,
                      '_blank'
                    )
                  }
                  className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                >
                  <span className='font-medium'>
                    {getThanksInfo(siteSettings.DoubanImageProxyType)!.text}
                  </span>
                  <ExternalLink className='w-3.5 opacity-70' />
                </button>
              </div>
            )}
          </div>

          {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
          {siteSettings.DoubanImageProxyType === 'custom' && (
            <div>
              <label
                htmlFor='site-field-5'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                豆瓣图片代理地址
              </label>
              <input
                id='site-field-5'
                type='text'
                placeholder='例如: https://proxy.example.com/fetch?url='
                value={siteSettings.DoubanImageProxy}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    DoubanImageProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-xs hover:border-gray-400 dark:hover:border-gray-500'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                自定义图片代理服务器地址
              </p>
            </div>
          )}
        </div>
        <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
          <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
            数据源配置
          </summary>
          <div className='mt-4 space-y-4'>
            {/* 轮播图数据源 */}
            <div>
              <label
                htmlFor='site-field-6'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                轮播图数据源
              </label>
              <select
                id='site-field-6'
                value={siteSettings.BannerDataSource || 'Douban'}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    BannerDataSource: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              >
                <option value='Douban'>豆瓣</option>
                <option value='TMDB'>TMDB</option>
                <option value='TX'>TX</option>
              </select>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                选择首页轮播图的数据来源
              </p>
            </div>

            {/* 更多推荐数据源 */}
            <div>
              <label
                htmlFor='site-field-7'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                更多推荐数据源
              </label>
              <select
                id='site-field-7'
                value={siteSettings.RecommendationDataSource || 'Mixed'}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    RecommendationDataSource: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              >
                <option value='Mixed'>混合</option>
                <option value='Douban'>豆瓣</option>
                <option value='TMDB'>TMDB</option>
              </select>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                选择详情页"更多推荐"的数据来源。混合模式会根据豆瓣ID和评论开关自动切换数据源
              </p>
            </div>
          </div>
        </details>
        <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
          <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
            TMDB 配置
          </summary>
          <div className='mt-4 space-y-4'>
            <p className='text-xs text-amber-600 dark:text-amber-400'>
              由于国内网络环境限制，TMDB 服务通常需要配置代理后才能正常使用。
            </p>
            {/* TMDB API Key */}
            <div>
              <label
                htmlFor='site-field-8'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                TMDB API Key
              </label>
              <input
                id='site-field-8'
                type='text'
                placeholder='请输入 TMDB API Key（多个key用英文逗号分隔）'
                value={siteSettings.TMDBApiKey}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    TMDBApiKey: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置后首页将显示 TMDB 即将上映电影。支持配置多个 API
                Key（用英文逗号分隔）以实现轮询，避免单个 Key 请求限制。获取 API
                Key 请访问{' '}
                <a
                  href='https://www.themoviedb.org/settings/api'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'
                >
                  TMDB API 设置页面
                </a>
              </p>
            </div>

            {/* TMDB Proxy */}
            <div>
              <label
                htmlFor='site-field-9'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                TMDB 系统代理
              </label>
              <input
                id='site-field-9'
                type='text'
                placeholder='请输入代理地址（可选）'
                value={siteSettings.TMDBProxy}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    TMDBProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置代理服务器地址，用于访问 TMDB API（可选）
              </p>
            </div>

            {/* TMDB Reverse Proxy */}
            <div>
              <label
                htmlFor='site-field-10'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                TMDB 反代代理
              </label>
              <input
                id='site-field-10'
                type='text'
                placeholder='请输入反代 Base URL（可选）'
                value={siteSettings.TMDBReverseProxy}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    TMDBReverseProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置 TMDB 反向代理 Base URL（可选）
              </p>
            </div>

            {/* TMDB Image Base URL */}
            <div>
              <label
                htmlFor='site-field-11'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                TMDB 图片默认地址
              </label>
              <input
                id='site-field-11'
                type='text'
                placeholder='https://image.tmdb.org'
                value={siteSettings.TMDBImageBaseUrl}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    TMDBImageBaseUrl: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                用户未在本地数据源设置中配置 TMDB
                图片地址时，图片默认使用该地址（默认 https://image.tmdb.org）
              </p>
            </div>
          </div>
        </details>
        <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
          <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
            动漫数据源配置
          </summary>
          <div className='mt-4 space-y-4'>
            <p className='text-xs text-amber-600 dark:text-amber-400'>
              Bangumi
              在部分国内网络环境下可能无法直连，可按部署环境选择合适的数据源。
            </p>

            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                默认动漫数据源
              </label>
              <div className='inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800'>
                {[
                  { value: 'direct', label: '直连' },
                  { value: 'server-proxy', label: '服务器代理' },
                  { value: 'sakura', label: '桜色镜像站' },
                  { value: 'custom-baseurl', label: '自定义 Base URL' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() =>
                      setSiteSettings((prev) => ({
                        ...prev,
                        BangumiDataSource:
                          option.value as SiteConfig['BangumiDataSource'],
                      }))
                    }
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      (siteSettings.BangumiDataSource || 'direct') ===
                      option.value
                        ? 'bg-white text-green-600 shadow-xs dark:bg-gray-700 dark:text-green-400'
                        : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                作为新用户本地设置的默认动漫数据源；用户仍可在本地网络配置中覆盖。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-12'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Bangumi Base URL
              </label>
              <input
                id='site-field-12'
                type='text'
                placeholder='https://api.bgm.tv'
                value={siteSettings.BangumiApiBaseUrl || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    BangumiApiBaseUrl: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                Bangumi 官方或自建反代地址，不要带末尾路径，例如
                https://api.bgm.tv。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-13'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Bangumi 图片 Base URL
              </label>
              <input
                id='site-field-13'
                type='text'
                placeholder='例如: https://proxy.example.com'
                value={siteSettings.BangumiImageBaseUrl || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    BangumiImageBaseUrl: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                用于替换 Bangumi
                图片域名。只需填写基础部分，不需要填写完整图片路径，例如
                https://lain.bgm.tv。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-14'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Bangumi 系统代理
              </label>
              <input
                id='site-field-14'
                type='text'
                placeholder='例如: http://127.0.0.1:7890'
                value={siteSettings.BangumiProxy || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    BangumiProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                用于服务器代理访问 Bangumi API。Cloudflare
                部署环境下不会使用该代理。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-15'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                LiveChart 系统代理
              </label>
              <input
                id='site-field-15'
                type='text'
                placeholder='例如: http://127.0.0.1:7890'
                value={siteSettings.LiveChartProxy || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    LiveChartProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                用于服务器代理访问 LiveChart 番剧时刻表。留空则直连。
              </p>
            </div>

            <details className='group rounded-lg border border-green-200 bg-green-50/60 p-4 dark:border-green-900/50 dark:bg-green-900/10'>
              <summary className='flex cursor-pointer list-none items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                    Bangumi Cloudflare Workers 代理脚本
                  </label>
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    复制后粘贴到 Cloudflare Workers，部署后的域名可填入 Bangumi
                    Base URL 和 Bangumi 图片 Base URL。
                  </p>
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  <button
                    type='button'
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCopyBangumiProxyScript();
                    }}
                    disabled={!bangumiProxyScript}
                    className='inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    <Copy className='h-3.5 w-3.5' />
                    {bangumiProxyScriptCopied ? '已复制' : '复制脚本'}
                  </button>
                  <ChevronDown className='h-4 w-4 text-green-600 transition-transform group-open:rotate-180 dark:text-green-400' />
                </div>
              </summary>
              <pre className='mt-3 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300'>
                <code>
                  {bangumiProxyScript ||
                    '正在加载 /scripts/bangumi-proxy.worker.js ...'}
                </code>
              </pre>
            </details>
          </div>
        </details>
      </section>
      <section
        role='tabpanel'
        id='site-panel-playback'
        aria-labelledby='site-tab-playback'
        hidden={siteTab !== 'playback'}
        className='space-y-6 max-w-4xl'
      >
        <div>
          <label
            htmlFor='site-field-16'
            className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
          >
            搜索接口可拉取最大页数
          </label>
          <input
            id='site-field-16'
            type='number'
            min={1}
            value={siteSettings.SearchDownstreamMaxPage}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                SearchDownstreamMaxPage: Number(e.target.value),
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
          />
        </div>
        <div>
          <label
            htmlFor='site-field-17'
            className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
          >
            站点接口缓存时间（秒）
          </label>
          <input
            id='site-field-17'
            type='number'
            min={1}
            value={siteSettings.SiteInterfaceCacheTime}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                SiteInterfaceCacheTime: Number(e.target.value),
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
          />
        </div>
        <div>
          <div className='flex items-center justify-between'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              禁用黄色过滤器
            </label>
            <button
              type='button'
              onClick={() =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DisableYellowFilter: !prev.DisableYellowFilter,
                }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                siteSettings.DisableYellowFilter
                  ? buttonStyles.toggleOn
                  : buttonStyles.toggleOff
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full ${
                  buttonStyles.toggleThumb
                } transition-transform ${
                  siteSettings.DisableYellowFilter
                    ? buttonStyles.toggleThumbOn
                    : buttonStyles.toggleThumbOff
                }`}
              />
            </button>
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            禁用黄色内容的过滤功能，允许显示所有内容。
          </p>
        </div>
        <div>
          <div className='flex items-center justify-between'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              启用流式搜索
            </label>
            <button
              type='button'
              onClick={() =>
                setSiteSettings((prev) => ({
                  ...prev,
                  FluidSearch: !prev.FluidSearch,
                }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                siteSettings.FluidSearch
                  ? buttonStyles.toggleOn
                  : buttonStyles.toggleOff
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full ${
                  buttonStyles.toggleThumb
                } transition-transform ${
                  siteSettings.FluidSearch
                    ? buttonStyles.toggleThumbOn
                    : buttonStyles.toggleThumbOff
                }`}
              />
            </button>
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            启用后搜索结果将实时流式返回,提升用户体验。
          </p>
        </div>
        <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
          <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
            弹幕配置
          </summary>
          <div className='mt-4 space-y-4'>
            <div className='inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800'>
              <button
                type='button'
                onClick={() =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    DanmakuSourceType: 'builtin',
                  }))
                }
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  siteSettings.DanmakuSourceType !== 'custom'
                    ? 'bg-white text-green-600 shadow-xs dark:bg-gray-700 dark:text-green-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                }`}
              >
                内置源
              </button>
              <button
                type='button'
                onClick={() =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    DanmakuSourceType: 'custom',
                  }))
                }
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  siteSettings.DanmakuSourceType === 'custom'
                    ? 'bg-white text-green-600 shadow-xs dark:bg-gray-700 dark:text-green-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                }`}
              >
                自定义源
              </button>
            </div>

            {siteSettings.DanmakuSourceType !== 'custom' && (
              <p className='text-xs text-amber-600 dark:text-amber-400'>
                ⚠️
                内置弹幕源为多人共享服务，稳定性可能受使用高峰影响，建议自行部署后使用自定义源。
              </p>
            )}

            {siteSettings.DanmakuSourceType === 'custom' && (
              <>
                {/* 弹幕 API 地址 */}
                <div>
                  <label
                    htmlFor='site-field-18'
                    className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
                  >
                    弹幕 API 地址
                  </label>
                  <input
                    id='site-field-18'
                    type='text'
                    placeholder='http://localhost:9321'
                    value={siteSettings.DanmakuApiBase}
                    onChange={(e) =>
                      setSiteSettings((prev) => ({
                        ...prev,
                        DanmakuApiBase: e.target.value,
                      }))
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                  />
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    自定义弹幕服务器的 API 地址。API部署参考
                    <a
                      href='https://github.com/huangxd-/danmu_api.git'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='ml-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'
                    >
                      danmu_api
                    </a>
                  </p>
                </div>

                {/* 弹幕 API Token */}
                <div>
                  <label
                    htmlFor='site-field-19'
                    className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
                  >
                    弹幕 API Token
                  </label>
                  <input
                    id='site-field-19'
                    type='text'
                    placeholder='87654321'
                    value={siteSettings.DanmakuApiToken}
                    onChange={(e) =>
                      setSiteSettings((prev) => ({
                        ...prev,
                        DanmakuApiToken: e.target.value,
                      }))
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                  />
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    自定义弹幕服务器的访问令牌，默认为 87654321
                  </p>
                </div>
              </>
            )}

            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  默认自动加载弹幕
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  新用户或未设置本地偏好时，播放页是否默认自动匹配并加载弹幕。用户仍可在个人设置中自行覆盖。
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={siteSettings.DanmakuAutoLoadDefault !== false}
                    onChange={(e) =>
                      setSiteSettings((prev) => ({
                        ...prev,
                        DanmakuAutoLoadDefault: e.target.checked,
                      }))
                    }
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>
          </div>
        </details>
        <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
          <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
            磁链配置
          </summary>
          <div className='mt-4 space-y-4'>
            <p className='text-xs text-amber-600 dark:text-amber-400'>
              由于国内网络环境限制，部分磁链搜索站点通常需要配置代理后才能正常访问。
            </p>
            <div>
              <label
                htmlFor='site-field-20'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                系统代理
              </label>
              <input
                id='site-field-20'
                type='text'
                placeholder='请输入代理地址（可选）'
                value={siteSettings.MagnetProxy || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    MagnetProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                用于访问磁链搜索站点的系统代理。Cloudflare
                部署环境下不会使用该代理。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-21'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Mikan 反代代理
              </label>
              <input
                id='site-field-21'
                type='text'
                placeholder='请输入 Mikan 反代 Base URL（可选）'
                value={siteSettings.MagnetMikanReverseProxy || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    MagnetMikanReverseProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置后将使用该地址替代默认的 Mikan 域名进行请求。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-22'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                动漫花园反代代理
              </label>
              <input
                id='site-field-22'
                type='text'
                placeholder='请输入动漫花园反代 Base URL（可选）'
                value={siteSettings.MagnetDmhyReverseProxy || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    MagnetDmhyReverseProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置后将使用该地址替代默认的动漫花园域名进行请求。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-23'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                ACG.RIP 反代代理
              </label>
              <input
                id='site-field-23'
                type='text'
                placeholder='请输入 ACG.RIP 反代 Base URL（可选）'
                value={siteSettings.MagnetAcgripReverseProxy || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    MagnetAcgripReverseProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置后将使用该地址替代默认的 ACG.RIP 域名进行请求。
              </p>
            </div>

            <div>
              <label
                htmlFor='site-field-24'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Nyaa 反代代理
              </label>
              <input
                id='site-field-24'
                type='text'
                placeholder='请输入 Nyaa 反代 Base URL（可选）'
                value={siteSettings.MagnetNyaaReverseProxy || ''}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    MagnetNyaaReverseProxy: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置后将使用该地址替代默认的 Nyaa 域名进行请求。
              </p>
            </div>
          </div>
        </details>
        <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
          <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
            Pansou 网盘搜索配置
          </summary>
          <div className='mt-4 space-y-4'>
            {/* Pansou API 地址 */}
            <div>
              <label
                htmlFor='site-field-25'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Pansou API 地址
              </label>
              <input
                id='site-field-25'
                type='text'
                placeholder='请输入 Pansou API 地址，如：http://localhost:8888'
                value={siteSettings.PansouApiUrl}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    PansouApiUrl: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置 Pansou 服务器地址，用于网盘资源搜索。项目地址：{' '}
                <a
                  href='https://github.com/fish2018/pansou'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'
                >
                  https://github.com/fish2018/pansou
                </a>
              </p>
            </div>

            {/* Pansou 账号 */}
            <div>
              <label
                htmlFor='site-field-26'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Pansou 账号（可选）
              </label>
              <input
                id='site-field-26'
                type='text'
                placeholder='如果 Pansou 启用了认证，请输入账号'
                value={siteSettings.PansouUsername}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    PansouUsername: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                如果 Pansou 服务启用了认证功能，需要提供账号密码
              </p>
            </div>

            {/* Pansou 密码 */}
            <div>
              <label
                htmlFor='site-field-27'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                Pansou 密码（可选）
              </label>
              <input
                id='site-field-27'
                type='password'
                placeholder='如果 Pansou 启用了认证，请输入密码'
                value={siteSettings.PansouPassword}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    PansouPassword: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                配置账号密码后，系统会自动登录并缓存 Token
              </p>
            </div>

            {/* 关键词屏蔽 */}
            <div>
              <label
                htmlFor='site-field-28'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'
              >
                关键词屏蔽（可选）
              </label>
              <input
                id='site-field-28'
                type='text'
                placeholder='多个关键词用中文或英文逗号分隔'
                value={siteSettings.PansouKeywordBlocklist}
                onChange={(e) =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    PansouKeywordBlocklist: e.target.value,
                  }))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                设置后会过滤包含这些关键词的搜索结果
              </p>
            </div>
          </div>
        </details>
        <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
          <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
            评论配置
          </summary>
          <div className='mt-4 space-y-4'>
            {/* 开启评论与相似推荐 */}
            <div>
              <div className='flex items-center justify-between'>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  开启评论与相似推荐
                </label>
                <button
                  type='button'
                  onClick={() =>
                    handleCommentsToggle(!siteSettings.EnableComments)
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    siteSettings.EnableComments
                      ? buttonStyles.toggleOn
                      : buttonStyles.toggleOff
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full ${
                      buttonStyles.toggleThumb
                    } transition-transform ${
                      siteSettings.EnableComments
                        ? buttonStyles.toggleThumbOn
                        : buttonStyles.toggleThumbOff
                    }`}
                  />
                </button>
              </div>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                开启后将显示豆瓣评论与相似推荐。评论为逆向抓取，请自行承担责任。
              </p>
            </div>
          </div>
        </details>
      </section>
      <section
        role='tabpanel'
        id='site-panel-analytics'
        aria-labelledby='site-tab-analytics'
        hidden={siteTab !== 'analytics'}
        className='space-y-6 max-w-4xl'
      >
        <details className='group rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
          <summary className='flex cursor-pointer items-center justify-between font-medium text-gray-900 dark:text-gray-100'>
            <span className='flex items-center gap-2'>
              <BarChart3 className='h-5 w-5' />
              流量统计
            </span>
            <ChevronDown className='h-5 w-5 transition-transform group-open:rotate-180' />
          </summary>
          <div className='mt-4 space-y-4'>
            {/* 启用开关 */}
            <div className='flex items-center justify-between'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                  启用流量统计
                </label>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  开启后将在页面中注入统计脚本，支持 Umami、Google Analytics
                  和自定义代码
                </p>
              </div>
              <button
                type='button'
                onClick={() =>
                  setSiteSettings((prev) => ({
                    ...prev,
                    AnalyticsEnabled: !prev.AnalyticsEnabled,
                  }))
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                  siteSettings.AnalyticsEnabled
                    ? buttonStyles.toggleOn
                    : buttonStyles.toggleOff
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full ${
                    buttonStyles.toggleThumb
                  } transition-transform ${
                    siteSettings.AnalyticsEnabled
                      ? buttonStyles.toggleThumbOn
                      : buttonStyles.toggleThumbOff
                  }`}
                />
              </button>
            </div>

            {siteSettings.AnalyticsEnabled && (
              <>
                {/* 统计服务提供商 */}
                <div>
                  <label
                    htmlFor='site-field-29'
                    className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                  >
                    统计服务
                  </label>
                  <select
                    id='site-field-29'
                    value={siteSettings.AnalyticsProvider}
                    onChange={(e) =>
                      setSiteSettings((prev) => ({
                        ...prev,
                        AnalyticsProvider: e.target.value as
                          | 'umami'
                          | 'google'
                          | 'clarity'
                          | 'custom',
                      }))
                    }
                    className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                  >
                    <option value='umami'>Umami（开源，自托管）</option>
                    <option value='google'>Google Analytics</option>
                    <option value='clarity'>
                      Microsoft Clarity（免费，热力图+会话回放）
                    </option>
                    <option value='custom'>自定义代码</option>
                  </select>
                </div>

                {siteSettings.AnalyticsProvider === 'umami' && (
                  <>
                    <div>
                      <label
                        htmlFor='site-field-30'
                        className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                      >
                        Umami 脚本地址
                      </label>
                      <input
                        id='site-field-30'
                        type='text'
                        value={siteSettings.AnalyticsScriptUrl}
                        onChange={(e) =>
                          setSiteSettings((prev) => ({
                            ...prev,
                            AnalyticsScriptUrl: e.target.value,
                          }))
                        }
                        placeholder='https://your-umami-server.com/script.js'
                        className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                      />
                      <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        Umami 实例的 script.js 完整 URL
                      </p>
                    </div>
                    <div>
                      <label
                        htmlFor='site-field-31'
                        className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                      >
                        网站 ID (Website ID)
                      </label>
                      <input
                        id='site-field-31'
                        type='text'
                        value={siteSettings.AnalyticsWebsiteId}
                        onChange={(e) =>
                          setSiteSettings((prev) => ({
                            ...prev,
                            AnalyticsWebsiteId: e.target.value,
                          }))
                        }
                        placeholder='e.g. 12345678-abcd-efgh-ijkl-1234567890ab'
                        className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                      />
                      <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        在 Umami 后台添加网站后获取的 Website ID
                      </p>
                    </div>
                  </>
                )}

                {siteSettings.AnalyticsProvider === 'google' && (
                  <div>
                    <label
                      htmlFor='site-field-32'
                      className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                    >
                      Measurement ID
                    </label>
                    <input
                      id='site-field-32'
                      type='text'
                      value={siteSettings.AnalyticsWebsiteId}
                      onChange={(e) =>
                        setSiteSettings((prev) => ({
                          ...prev,
                          AnalyticsWebsiteId: e.target.value,
                        }))
                      }
                      placeholder='G-XXXXXXXXXX'
                      className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                    />
                    <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      Google Analytics 4 的 Measurement ID，在 GA
                      后台「数据流」中获取
                    </p>
                  </div>
                )}

                {siteSettings.AnalyticsProvider === 'clarity' && (
                  <div>
                    <label
                      htmlFor='site-field-33'
                      className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                    >
                      Project ID
                    </label>
                    <input
                      id='site-field-33'
                      type='text'
                      value={siteSettings.AnalyticsWebsiteId}
                      onChange={(e) =>
                        setSiteSettings((prev) => ({
                          ...prev,
                          AnalyticsWebsiteId: e.target.value,
                        }))
                      }
                      placeholder='e.g. abc1234567'
                      className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                    />
                    <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      Microsoft Clarity 的 Project ID，在 clarity.microsoft.com
                      项目设置中获取
                    </p>
                  </div>
                )}

                {siteSettings.AnalyticsProvider === 'custom' && (
                  <div>
                    <label
                      htmlFor='site-field-34'
                      className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                    >
                      自定义统计代码
                    </label>
                    <textarea
                      id='site-field-34'
                      value={siteSettings.AnalyticsCustomScript}
                      onChange={(e) =>
                        setSiteSettings((prev) => ({
                          ...prev,
                          AnalyticsCustomScript: e.target.value,
                        }))
                      }
                      placeholder='粘贴完整的统计脚本代码，如百度统计、Plausible、51la 等...'
                      rows={6}
                      className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                    />
                    <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      支持任意第三方统计服务的脚本代码，将直接注入到页面
                      &lt;head&gt; 中
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </details>
      </section>
      <div className='admin-savebar flex flex-wrap items-center justify-between gap-3'>
        <p className='text-sm text-slate-500'>
          {siteDirty
            ? '有未保存的更改 · 保存后应用所有分组'
            : '所有分组的设置在此保存'}
        </p>
        <button
          onClick={handleSave}
          disabled={isLoading('saveSiteConfig')}
          className={`px-4 py-2 ${
            isLoading('saveSiteConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          } rounded-lg transition-colors`}
        >
          {isLoading('saveSiteConfig') ? '保存中…' : '保存站点设置'}
        </button>
      </div>
      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
      {/* 开启评论确认弹窗 */}
      {showEnableCommentsModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => setShowEnableCommentsModal(false)}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    开启评论与相似推荐功能
                  </h3>
                  <button
                    onClick={() => setShowEnableCommentsModal(false)}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <AlertTriangle className='w-5 h-5 text-yellow-600 dark:text-yellow-400' />
                      <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                        重要提示
                      </span>
                    </div>
                    <p className='text-sm text-yellow-700 dark:text-yellow-400'>
                      评论功能为逆向抓取豆瓣评论数据，此功能仅供学习，开启后请自行承担相关责任和风险。
                    </p>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => setShowEnableCommentsModal(false)}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmEnableComments}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.primary}`}
                  >
                    我已知晓，确认开启
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
