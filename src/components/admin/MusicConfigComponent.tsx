
'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

export const MusicConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [showMusicDisclaimer, setShowMusicDisclaimer] = useState(false);
  const [musicCountdown, setMusicCountdown] = useState(10);

  useEffect(() => {
    if (config?.MusicConfig) {
      setEnabled(config.MusicConfig.Enabled || false);
      setBaseUrl(config.MusicConfig.BaseUrl || '');
      setToken(config.MusicConfig.Token || '');
      setProxyEnabled(config.MusicConfig.ProxyEnabled ?? true);
    }
  }, [config]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showMusicDisclaimer && musicCountdown > 0) {
      timer = setTimeout(() => setMusicCountdown(musicCountdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [showMusicDisclaimer, musicCountdown]);

  const handleSave = async () => {
    await withLoading('saveMusicConfig', async () => {
      try {
        const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '');

        if (enabled && !normalizedBaseUrl) {
          throw new Error('启用音乐功能时必须填写 lxserver 地址');
        }

        const response = await fetch('/api/admin/music', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Enabled: enabled,
            BaseUrl: normalizedBaseUrl,
            Token: token.trim(),
            ProxyEnabled: proxyEnabled,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '保存失败');
        }

        showSuccess('音乐配置保存成功', showAlert);
        await refreshConfig();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '保存失败',
          showAlert
        );
        throw error;
      }
    });
  };

  return (
    <div className='space-y-6'>
      <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
        <div className='flex items-center gap-2 mb-2'>
          <svg
            className='w-5 h-5 text-blue-600 dark:text-blue-400'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
            />
          </svg>
          <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
            使用说明
          </span>
        </div>
        <div className='text-sm text-blue-700 dark:text-blue-400 space-y-1'>
          <p>
            • 音乐功能基于 lxserver 提供搜索、热搜、榜单、歌词与播放解析能力
          </p>
          <p>
            • 建议填写服务端 Base URL 与持久 Token，由 PureTV 服务端代为访问
            lxserver
          </p>
          <p>
            • 项目地址：
            <a
              href='https://github.com/XCQ0607/lxserver'
              target='_blank'
              rel='noreferrer'
              className='underline hover:text-blue-500'
            >
              https://github.com/XCQ0607/lxserver
            </a>
          </p>
        </div>
      </div>

      <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
        <div>
          <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            启用音乐功能
          </h3>
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            关闭后不显示音乐入口，前端音乐页与接口将不可用
          </p>
        </div>
        <label className='relative inline-flex items-center cursor-pointer'>
          <input
            type='checkbox'
            checked={enabled}
            onChange={(e) => {
              if (e.target.checked) {
                setShowMusicDisclaimer(true);
                setMusicCountdown(10);
              } else {
                setEnabled(false);
              }
            }}
            className='sr-only peer'
          />
          <div className="w-14 h-7 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:inset-s-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all dark:border-gray-600 peer-checked:bg-green-600"></div>
        </label>
      </div>

      {/* 音乐免责声明弹窗 */}
      {showMusicDisclaimer &&
        createPortal(
          <div className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'>
            <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-red-200 dark:border-red-800'>
              <div className='p-6'>
                <div className='flex justify-center mb-4'>
                  <AlertTriangle className='w-12 h-12 text-red-500' />
                </div>

                <h3 className='text-xl font-bold text-gray-900 dark:text-gray-100 mb-4 text-center'>
                  免责声明
                </h3>

                <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6'>
                  <p className='text-sm text-gray-700 dark:text-gray-300 leading-relaxed'>
                    本功能仅供个人学习和技术研究使用，请勿将其部署在公网环境中，更不得用于任何违法违规行为。
                    使用本功能所产生的一切法律责任由使用者自行承担，与开发者无关。
                    启用此功能即表示您已充分理解并同意承担相应风险。
                  </p>
                </div>

                <div className='flex gap-3 justify-center'>
                  <button
                    onClick={() => {
                      setShowMusicDisclaimer(false);
                      setMusicCountdown(10);
                    }}
                    className={buttonStyles.secondary}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      setEnabled(true);
                      setShowMusicDisclaimer(false);
                      setMusicCountdown(10);
                    }}
                    disabled={musicCountdown > 0}
                    className={
                      musicCountdown > 0
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }
                  >
                    {musicCountdown > 0
                      ? `确认 (${musicCountdown}s)`
                      : '确认启用'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <div className='space-y-4'>
        <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              启用播放代理
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              开启后走服务器代理并设置浏览器永久缓存，关闭后将每次都解析播放链接
            </p>
          </div>
          <label className='relative inline-flex items-center cursor-pointer'>
            <input
              type='checkbox'
              checked={proxyEnabled}
              onChange={(e) => setProxyEnabled(e.target.checked)}
              className='sr-only peer'
            />
            <div className="w-14 h-7 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:inset-s-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all dark:border-gray-600 peer-checked:bg-green-600"></div>
          </label>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            lxserver Base URL
          </label>
          <input
            type='text'
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder='http://127.0.0.1:9527'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            例如： http://127.0.0.1:9527 或 https://music.example.com
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            x-user-token
          </label>
          <input
            type='password'
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder='lx_tk_xxx'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            推荐填写 lxserver 持久 Token；留空则按匿名访问处理
          </p>
        </div>
      </div>

      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveMusicConfig')}
          className={
            isLoading('saveMusicConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          }
        >
          {isLoading('saveMusicConfig') ? '保存中...' : '保存音乐配置'}
        </button>
      </div>

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
