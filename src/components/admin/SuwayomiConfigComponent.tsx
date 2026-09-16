
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

export const SuwayomiConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [enabled, setEnabled] = useState(false);
  const [serverURL, setServerURL] = useState('');
  const [authMode, setAuthMode] = useState<
    'none' | 'basic_auth' | 'simple_login'
  >('none');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [defaultLang, setDefaultLang] = useState('zh');
  const [sourceIds, setSourceIds] = useState('');
  const [maxSources, setMaxSources] = useState(10);
  const [showMangaDisclaimer, setShowMangaDisclaimer] = useState(false);
  const [mangaCountdown, setMangaCountdown] = useState(10);

  useEffect(() => {
    if (config?.SuwayomiConfig) {
      setEnabled(config.SuwayomiConfig.Enabled || false);
      setServerURL(config.SuwayomiConfig.ServerURL || '');
      setAuthMode(config.SuwayomiConfig.AuthMode || 'none');
      setUsername(config.SuwayomiConfig.Username || '');
      setPassword(config.SuwayomiConfig.Password || '');
      setDefaultLang(config.SuwayomiConfig.DefaultLang || 'zh');
      setSourceIds((config.SuwayomiConfig.SourceIds || []).join(','));
      setMaxSources(config.SuwayomiConfig.MaxSources || 10);
    }
  }, [config]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showMangaDisclaimer && mangaCountdown > 0) {
      timer = setTimeout(() => setMangaCountdown(mangaCountdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [showMangaDisclaimer, mangaCountdown]);

  const buildConfig = () => ({
    Enabled: enabled,
    ServerURL: serverURL,
    AuthMode: authMode,
    Username: authMode === 'none' ? '' : username,
    Password: authMode === 'none' ? '' : password,
    DefaultLang: defaultLang || 'zh',
    SourceIds: sourceIds
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    MaxSources: Math.max(1, maxSources || 10),
  });

  const handleSave = async () => {
    await withLoading('saveSuwayomi', async () => {
      try {
        if (!config) throw new Error('配置未加载');

        const response = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            SuwayomiConfig: buildConfig(),
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || '保存失败');
        }

        showSuccess('漫画后端配置已保存', showAlert);
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

  const handleTest = async () => {
    await withLoading('testSuwayomi', async () => {
      try {
        const response = await fetch('/api/admin/suwayomi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ServerURL: serverURL,
            AuthMode: authMode,
            Username: username,
            Password: password,
            DefaultLang: defaultLang,
          }),
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || data.error || '测试连接失败');
        }

        showSuccess(data.message || '连接成功', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '测试连接失败',
          showAlert
        );
        throw error;
      }
    });
  };

  return (
    <div className='space-y-6'>
      <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
        <h3 className='text-sm font-medium text-blue-900 dark:text-blue-100 mb-2'>
          关于漫画展馆 / Suwayomi
        </h3>
        <div className='text-sm text-blue-800 dark:text-blue-200 space-y-1'>
          <p>
            • 漫画展馆通过 Suwayomi Server 的 GraphQL
            接口搜索、拉取章节与阅读页。
          </p>
          <p>
            • 认证仅支持 basic_auth 与
            simple_login；未开启认证时请选择“无认证”。
          </p>
          <p>• 可限制默认语言、可用源白名单，以及单次搜索最多查询的源数量。</p>
          <p>• 保存后漫画模块会优先使用这里的配置，环境变量只作为兜底。</p>
        </div>
      </div>

      <div className='space-y-4'>
        <div className='flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              启用漫画展馆
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              关闭后仍保留代码，但不建议在未配置时对用户开放入口。
            </p>
          </div>
          <button
            onClick={() => {
              if (!enabled) {
                setShowMangaDisclaimer(true);
                setMangaCountdown(10);
              } else {
                setEnabled(false);
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 漫画展馆免责声明弹窗 */}
        {showMangaDisclaimer &&
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
                        setShowMangaDisclaimer(false);
                        setMangaCountdown(10);
                      }}
                      className={buttonStyles.secondary}
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        setEnabled(true);
                        setShowMangaDisclaimer(false);
                        setMangaCountdown(10);
                      }}
                      disabled={mangaCountdown > 0}
                      className={
                        mangaCountdown > 0
                          ? buttonStyles.disabled
                          : buttonStyles.danger
                      }
                    >
                      {mangaCountdown > 0
                        ? `确认 (${mangaCountdown}s)`
                        : '确认启用'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            Suwayomi 服务地址
          </label>
          <input
            type='text'
            value={serverURL}
            onChange={(e) => setServerURL(e.target.value)}
            placeholder='http://127.0.0.1:4567'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            只填服务根地址，程序会自动拼接 /api/graphql。
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            认证方式
          </label>
          <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
            {[
              { value: 'none', label: '无认证' },
              { value: 'basic_auth', label: 'basic_auth' },
              { value: 'simple_login', label: 'simple_login' },
            ].map((item) => (
              <button
                key={item.value}
                type='button'
                onClick={() =>
                  setAuthMode(
                    item.value as 'none' | 'basic_auth' | 'simple_login'
                  )
                }
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  authMode === item.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-200'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            basic_auth 使用 Basic Authorization 头；simple_login 会向
            /login.html 提交表单并复用返回 Cookie。
          </p>
        </div>

        {authMode !== 'none' && (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                用户名
              </label>
              <input
                type='text'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder='登录用户名'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                密码
              </label>
              <input
                type='password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='登录密码'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
          </div>
        )}

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              默认语言
            </label>
            <input
              type='text'
              value={defaultLang}
              onChange={(e) => setDefaultLang(e.target.value)}
              placeholder='zh'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              单次搜索最大源数
            </label>
            <input
              type='number'
              min='1'
              value={maxSources}
              onChange={(e) => setMaxSources(parseInt(e.target.value) || 10)}
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            源白名单
          </label>
          <textarea
            value={sourceIds}
            onChange={(e) => setSourceIds(e.target.value)}
            rows={3}
            placeholder='留空表示使用默认语言下全部源；填写时用英文逗号分隔 sourceId'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
        </div>

        <div className='flex gap-3'>
          <button
            onClick={handleTest}
            disabled={!serverURL || isLoading('testSuwayomi')}
            className={buttonStyles.primary}
          >
            {isLoading('testSuwayomi') ? '测试中...' : '测试连接'}
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading('saveSuwayomi')}
            className={buttonStyles.success}
          >
            {isLoading('saveSuwayomi') ? '保存中...' : '保存配置'}
          </button>
        </div>
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
