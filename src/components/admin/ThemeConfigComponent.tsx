
'use client';

import { Check, Palette } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';

import {
  AlertModal,
  buttonStyles,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';
import ProxyImage from '@/components/ProxyImage';

export const ThemeConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [themeSettings, setThemeSettings] = useState({
    enableBuiltInTheme: false,
    builtInTheme: 'default',
    customCSS: '',
    enableCache: true,
    cacheMinutes: 1440, // 默认1天（1440分钟）
    progressThumbType: 'default' as 'default' | 'preset' | 'custom',
    progressThumbPresetId: '',
    progressThumbCustomUrl: '',
  });
  const [loginBackgroundImages, setLoginBackgroundImages] = useState<string[]>([
    '',
  ]);
  const [registerBackgroundImages, setRegisterBackgroundImages] = useState<
    string[]
  >(['']);
  const [homeBackgroundImages, setHomeBackgroundImages] = useState<string[]>([
    '',
  ]);

  useEffect(() => {
    if (config?.ThemeConfig) {
      setThemeSettings({
        enableBuiltInTheme: config.ThemeConfig.enableBuiltInTheme || false,
        builtInTheme: config.ThemeConfig.builtInTheme || 'default',
        customCSS: config.ThemeConfig.customCSS || '',
        enableCache: config.ThemeConfig.enableCache !== false,
        cacheMinutes: config.ThemeConfig.cacheMinutes || 1440,
        progressThumbType: config.ThemeConfig.progressThumbType || 'default',
        progressThumbPresetId: config.ThemeConfig.progressThumbPresetId || '',
        progressThumbCustomUrl: config.ThemeConfig.progressThumbCustomUrl || '',
      });

      // 解析背景图配置
      if (config.ThemeConfig.loginBackgroundImage) {
        const urls = config.ThemeConfig.loginBackgroundImage
          .split('\n')
          .map((url) => url.trim())
          .filter((url) => url !== '');
        setLoginBackgroundImages(urls.length > 0 ? urls : ['']);
      } else {
        setLoginBackgroundImages(['']);
      }

      if (config.ThemeConfig.registerBackgroundImage) {
        const urls = config.ThemeConfig.registerBackgroundImage
          .split('\n')
          .map((url) => url.trim())
          .filter((url) => url !== '');
        setRegisterBackgroundImages(urls.length > 0 ? urls : ['']);
      } else {
        setRegisterBackgroundImages(['']);
      }

      if (config.ThemeConfig.homeBackgroundImage) {
        const urls = config.ThemeConfig.homeBackgroundImage
          .split('\n')
          .map((url) => url.trim())
          .filter((url) => url !== '');
        setHomeBackgroundImages(urls.length > 0 ? urls : ['']);
      } else {
        setHomeBackgroundImages(['']);
      }
    }
  }, [config]);

  const handleSave = async () => {
    await withLoading('saveThemeConfig', async () => {
      try {
        // 验证登录背景图URL格式
        const validLoginUrls = loginBackgroundImages
          .map((url) => url.trim())
          .filter((url) => url !== '');

        for (const url of validLoginUrls) {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            showAlert({
              type: 'error',
              title: '格式错误',
              message: `登录界面背景图URL格式错误：${url}\n每个URL必须以http://或https://开头`,
              showConfirm: true,
            });
            return;
          }
        }

        // 验证注册背景图URL格式
        const validRegisterUrls = registerBackgroundImages
          .map((url) => url.trim())
          .filter((url) => url !== '');

        for (const url of validRegisterUrls) {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            showAlert({
              type: 'error',
              title: '格式错误',
              message: `注册界面背景图URL格式错误：${url}\n每个URL必须以http://或https://开头`,
              showConfirm: true,
            });
            return;
          }
        }

        const validHomeUrls = homeBackgroundImages
          .map((url) => url.trim())
          .filter((url) => url !== '');

        for (const url of validHomeUrls) {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            showAlert({
              type: 'error',
              title: '格式错误',
              message: `首页背景图URL格式错误：${url}\n每个URL必须以http://或https://开头`,
              showConfirm: true,
            });
            return;
          }
        }

        const response = await fetch('/api/admin/theme', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...themeSettings,
            loginBackgroundImage: validLoginUrls.join('\n'),
            registerBackgroundImage: validRegisterUrls.join('\n'),
            homeBackgroundImage: validHomeUrls.join('\n'),
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || '保存失败');
        }

        showAlert({
          type: 'success',
          title: '保存成功',
          message: '个性化配置已更新',
          timer: 2000,
        });

        await refreshConfig();

        // 刷新页面以应用新主题
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } catch (error) {
        showAlert({
          type: 'error',
          title: '保存失败',
          message: (error as Error).message,
        });
      }
    });
  };

  const builtInThemes = [
    {
      value: 'default',
      label: '默认主题',
      color: '#3b82f6',
    },
    {
      value: 'dark_blue',
      label: '深蓝夜空',
      color: '#3b82f6',
    },
    {
      value: 'purple_dream',
      label: '紫色梦境',
      color: '#a78bfa',
    },
    {
      value: 'green_forest',
      label: '翠绿森林',
      color: '#10b981',
    },
    {
      value: 'orange_sunset',
      label: '橙色日落',
      color: '#f97316',
    },
    {
      value: 'pink_candy',
      label: '粉色糖果',
      color: '#ec4899',
    },
    {
      value: 'cyan_ocean',
      label: '青色海洋',
      color: '#06b6d4',
    },
  ];

  return (
    <div className='space-y-6'>
      {/* 主题类型选择 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700'>
        <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>
          主题类型
        </h3>
        <div className='space-y-4'>
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='radio'
              checked={!themeSettings.enableBuiltInTheme}
              onChange={() =>
                setThemeSettings((prev) => ({
                  ...prev,
                  enableBuiltInTheme: false,
                }))
              }
              className='w-4 h-4 text-blue-600'
            />
            <span className='text-gray-900 dark:text-gray-100'>
              自定义CSS（使用下方的CSS编辑器）
            </span>
          </label>
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='radio'
              checked={themeSettings.enableBuiltInTheme}
              onChange={() =>
                setThemeSettings((prev) => ({
                  ...prev,
                  enableBuiltInTheme: true,
                }))
              }
              className='w-4 h-4 text-blue-600'
            />
            <span className='text-gray-900 dark:text-gray-100'>
              内置主题（使用预设的主题样式）
            </span>
          </label>
        </div>
      </div>

      {/* 内置主题选择 */}
      {themeSettings.enableBuiltInTheme && (
        <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>
            选择内置主题
          </h3>
          <div className='flex flex-wrap gap-3'>
            {builtInThemes.map((theme) => (
              <div
                key={theme.value}
                onClick={() =>
                  setThemeSettings((prev) => ({
                    ...prev,
                    builtInTheme: theme.value,
                  }))
                }
                className={`cursor-pointer rounded-lg border-2 p-3 transition-all hover:shadow-md ${
                  themeSettings.builtInTheme === theme.value
                    ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className='flex items-center gap-3'>
                  {/* 圆形颜色预览 */}
                  <div
                    className='w-10 h-10 rounded-full shrink-0 shadow-xs'
                    style={{ backgroundColor: theme.color }}
                  />
                  {/* 主题名称 */}
                  <div className='flex items-center gap-2'>
                    <span className='text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap'>
                      {theme.label}
                    </span>
                    {themeSettings.builtInTheme === theme.value && (
                      <div className='w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0'>
                        <svg
                          className='w-2.5 h-2.5 text-white'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={3}
                            d='M5 13l4 4L19 7'
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
            注意：启用内置主题时，自定义CSS将被禁用
          </p>
        </div>
      )}

      {/* 自定义CSS编辑器 */}
      {!themeSettings.enableBuiltInTheme && (
        <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>
            自定义CSS
          </h3>
          <textarea
            value={themeSettings.customCSS}
            onChange={(e) =>
              setThemeSettings((prev) => ({
                ...prev,
                customCSS: e.target.value,
              }))
            }
            placeholder='在此输入自定义CSS代码...'
            className='w-full h-96 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent'
          />
          <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
            提示：可以使用CSS变量、媒体查询等高级特性
          </p>
        </div>
      )}

      {/* 缓存设置 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700'>
        <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>
          缓存设置
        </h3>
        <div className='space-y-4'>
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='checkbox'
              checked={themeSettings.enableCache}
              onChange={(e) =>
                setThemeSettings((prev) => ({
                  ...prev,
                  enableCache: e.target.checked,
                }))
              }
              className='w-4 h-4 text-blue-600 rounded-sm'
            />
            <span className='text-gray-900 dark:text-gray-100'>
              启用浏览器缓存（推荐）
            </span>
          </label>

          {themeSettings.enableCache && (
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                缓存时间（分钟）
              </label>
              <input
                type='number'
                min='1'
                max='43200'
                value={themeSettings.cacheMinutes}
                onChange={(e) =>
                  setThemeSettings((prev) => ({
                    ...prev,
                    cacheMinutes: parseInt(e.target.value) || 1440,
                  }))
                }
                className='w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                建议值：60分钟（1小时）、1440分钟（1天）、10080分钟（7天）
              </p>
            </div>
          )}
        </div>
        <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
          启用后，用户浏览器会缓存CSS文件指定时间，减少服务器负载。启用该项可能会导致主题更新延迟。
        </p>
      </div>

      {/* 背景图配置 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700'>
        <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>
          背景图配置
        </h3>
        <div className='space-y-6'>
          {/* 登录界面背景图 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              登录界面背景图
            </label>
            <div className='space-y-2'>
              {loginBackgroundImages.map((url, index) => (
                <div key={index} className='flex gap-2'>
                  <input
                    type='text'
                    value={url}
                    onChange={(e) => {
                      const newImages = [...loginBackgroundImages];
                      newImages[index] = e.target.value;
                      setLoginBackgroundImages(newImages);
                    }}
                    placeholder='请输入登录界面背景图URL (http:// 或 https://)'
                    className='flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm'
                  />
                  {loginBackgroundImages.length > 1 && (
                    <button
                      type='button'
                      onClick={() => {
                        setLoginBackgroundImages(
                          loginBackgroundImages.filter((_, i) => i !== index)
                        );
                      }}
                      className='px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors'
                      title='删除'
                    >
                      <svg
                        className='w-5 h-5'
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
                  )}
                </div>
              ))}
              <button
                type='button'
                onClick={() =>
                  setLoginBackgroundImages([...loginBackgroundImages, ''])
                }
                className='flex items-center gap-2 px-4 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors'
              >
                <svg
                  className='w-5 h-5'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 4v16m8-8H4'
                  />
                </svg>
                <span>添加URL</span>
              </button>
            </div>
          </div>

          {/* 注册界面背景图 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              注册界面背景图
            </label>
            <div className='space-y-2'>
              {registerBackgroundImages.map((url, index) => (
                <div key={index} className='flex gap-2'>
                  <input
                    type='text'
                    value={url}
                    onChange={(e) => {
                      const newImages = [...registerBackgroundImages];
                      newImages[index] = e.target.value;
                      setRegisterBackgroundImages(newImages);
                    }}
                    placeholder='请输入注册界面背景图URL (http:// 或 https://)'
                    className='flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm'
                  />
                  {registerBackgroundImages.length > 1 && (
                    <button
                      type='button'
                      onClick={() => {
                        setRegisterBackgroundImages(
                          registerBackgroundImages.filter((_, i) => i !== index)
                        );
                      }}
                      className='px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors'
                      title='删除'
                    >
                      <svg
                        className='w-5 h-5'
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
                  )}
                </div>
              ))}
              <button
                type='button'
                onClick={() =>
                  setRegisterBackgroundImages([...registerBackgroundImages, ''])
                }
                className='flex items-center gap-2 px-4 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors'
              >
                <svg
                  className='w-5 h-5'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 4v16m8-8H4'
                  />
                </svg>
                <span>添加URL</span>
              </button>
            </div>
          </div>

          {/* 首页背景图 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              首页背景图
            </label>
            <div className='space-y-2'>
              {homeBackgroundImages.map((url, index) => (
                <div key={index} className='flex gap-2'>
                  <input
                    type='text'
                    value={url}
                    onChange={(e) => {
                      const newImages = [...homeBackgroundImages];
                      newImages[index] = e.target.value;
                      setHomeBackgroundImages(newImages);
                    }}
                    placeholder='请输入首页背景图URL (http:// 或 https://)'
                    className='flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm'
                  />
                  {homeBackgroundImages.length > 1 && (
                    <button
                      type='button'
                      onClick={() => {
                        setHomeBackgroundImages(
                          homeBackgroundImages.filter((_, i) => i !== index)
                        );
                      }}
                      className='px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors'
                      title='删除'
                    >
                      <svg
                        className='w-5 h-5'
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
                  )}
                </div>
              ))}
              <button
                type='button'
                onClick={() =>
                  setHomeBackgroundImages([...homeBackgroundImages, ''])
                }
                className='flex items-center gap-2 px-4 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors'
              >
                <svg
                  className='w-5 h-5'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 4v16m8-8H4'
                  />
                </svg>
                <span>添加URL</span>
              </button>
            </div>
          </div>
        </div>
        <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
          配置登录、注册和首页的背景图链接，留空则使用默认样式。支持配置多张图片，将随机展示其中一张
        </p>
      </div>

      {/* 进度条图标配置 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700'>
        <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2'>
          <Palette className='w-5 h-5' />
          进度条图标
        </h3>
        <p className='text-sm text-gray-600 dark:text-gray-400 mb-4'>
          自定义视频播放器进度条的滑块图标，让播放器更具个性
        </p>

        {/* 图标类型选择 */}
        <div className='space-y-4 mb-6'>
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='radio'
              checked={themeSettings.progressThumbType === 'default'}
              onChange={() =>
                setThemeSettings((prev) => ({
                  ...prev,
                  progressThumbType: 'default',
                }))
              }
              className='w-4 h-4 text-blue-600'
            />
            <span className='text-gray-900 dark:text-gray-100'>默认圆点</span>
          </label>
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='radio'
              checked={themeSettings.progressThumbType === 'preset'}
              onChange={() =>
                setThemeSettings((prev) => ({
                  ...prev,
                  progressThumbType: 'preset',
                }))
              }
              className='w-4 h-4 text-blue-600'
            />
            <span className='text-gray-900 dark:text-gray-100'>内置图标</span>
          </label>
          <label className='flex items-center space-x-3 cursor-pointer'>
            <input
              type='radio'
              checked={themeSettings.progressThumbType === 'custom'}
              onChange={() =>
                setThemeSettings((prev) => ({
                  ...prev,
                  progressThumbType: 'custom',
                }))
              }
              className='w-4 h-4 text-blue-600'
            />
            <span className='text-gray-900 dark:text-gray-100'>自定义图标</span>
          </label>
        </div>

        {/* 预制图标选择 */}
        {themeSettings.progressThumbType === 'preset' && (
          <div className='space-y-3 mb-4'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
              选择内置图标
            </label>
            <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
              {[
                {
                  id: 'renako',
                  name: '玲奈子',
                  url: '/icons/q/renako.png',
                  color: '#ec4899',
                },
                {
                  id: 'irena',
                  name: '伊蕾娜',
                  url: '/icons/q/irena.png',
                  color: '#f8fafc',
                },
                {
                  id: 'emilia',
                  name: '爱蜜莉雅',
                  url: '/icons/q/emilia.png',
                  color: '#f8fafc',
                },
              ].map((thumb) => (
                <button
                  key={thumb.id}
                  type='button'
                  onClick={() =>
                    setThemeSettings((prev) => ({
                      ...prev,
                      progressThumbPresetId: thumb.id,
                    }))
                  }
                  className={`relative p-4 border-2 rounded-lg transition-all ${
                    themeSettings.progressThumbPresetId === thumb.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <div className='flex flex-col items-center gap-2'>
                    <ProxyImage
                      originalSrc={thumb.url}
                      alt={thumb.name}
                      className='w-12 h-12 object-contain'
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" fill="%23ddd"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
                      }}
                    />
                    <span className='text-sm font-medium text-gray-700 dark:text-gray-300 text-center'>
                      {thumb.name}
                    </span>
                    <div
                      className='w-8 h-2 rounded-full'
                      style={{ backgroundColor: thumb.color }}
                      title='进度条颜色'
                    />
                  </div>
                  {themeSettings.progressThumbPresetId === thumb.id && (
                    <div className='absolute top-2 right-2'>
                      <Check className='w-5 h-5 text-blue-600 dark:text-blue-400' />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 自定义图标URL输入 */}
        {themeSettings.progressThumbType === 'custom' && (
          <div className='space-y-3'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
              自定义图标URL
            </label>
            <input
              type='text'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
              placeholder='例如: https://example.com/icon.png'
              value={themeSettings.progressThumbCustomUrl}
              onChange={(e) =>
                setThemeSettings((prev) => ({
                  ...prev,
                  progressThumbCustomUrl: e.target.value,
                }))
              }
            />
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              支持 PNG、JPG、GIF、WebP 格式，建议尺寸
              32x32px，图片URL必须可公开访问
            </p>
            {themeSettings.progressThumbCustomUrl && (
              <div className='mt-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg'>
                <p className='text-xs text-gray-600 dark:text-gray-400 mb-2'>
                  预览：
                </p>
                <ProxyImage
                  originalSrc={themeSettings.progressThumbCustomUrl}
                  alt='自定义图标预览'
                  className='w-12 h-12 object-contain border border-gray-300 dark:border-gray-600 rounded-sm'
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    const parent = (e.target as HTMLImageElement).parentElement;
                    if (parent && !parent.querySelector('.error-msg')) {
                      const errorMsg = document.createElement('p');
                      errorMsg.className = 'text-xs text-red-500 error-msg';
                      errorMsg.textContent = '图片加载失败，请检查URL是否正确';
                      parent.appendChild(errorMsg);
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 保存按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveThemeConfig')}
          className={
            isLoading('saveThemeConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          }
        >
          {isLoading('saveThemeConfig') ? '保存中...' : '保存个性化配置'}
        </button>
      </div>

      {/* 弹窗 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};
