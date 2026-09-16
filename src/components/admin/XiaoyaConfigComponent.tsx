'use client';

import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from './shared';

export const XiaoyaConfigComponent = ({
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
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [disableVideoPreview, setDisableVideoPreview] = useState(false);

  useEffect(() => {
    if (config?.XiaoyaConfig) {
      setEnabled(config.XiaoyaConfig.Enabled || false);
      setServerURL(config.XiaoyaConfig.ServerURL || '');
      setToken(config.XiaoyaConfig.Token || '');
      setUsername(config.XiaoyaConfig.Username || '');
      setPassword(config.XiaoyaConfig.Password || '');
      setDisableVideoPreview(config.XiaoyaConfig.DisableVideoPreview || false);
    }
  }, [config]);

  const handleSave = async () => {
    await withLoading('saveXiaoya', async () => {
      try {
        const response = await fetch('/api/admin/xiaoya', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            Enabled: enabled,
            ServerURL: serverURL,
            Token: token,
            Username: username,
            Password: password,
            DisableVideoPreview: disableVideoPreview,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || '保存失败');
        }

        showSuccess('保存成功', showAlert);
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
    await withLoading('testXiaoya', async () => {
      try {
        const response = await fetch('/api/admin/xiaoya', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'test',
            ServerURL: serverURL,
            Token: token,
            Username: username,
            Password: password,
          }),
        });

        const data = await response.json();
        if (data.success) {
          showSuccess('连接成功', showAlert);
        } else {
          showError(data.message || '连接失败', showAlert);
        }
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '连接失败',
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
          关于小雅
        </h3>
        <div className='text-sm text-blue-800 dark:text-blue-200 space-y-1'>
          <p>• 小雅是基于 Alist 的网盘资源聚合服务</p>
          <p>
            • 支持文件夹名自动识别 TMDb ID（格式：标题 (年份) {'{tmdb-id}'}）
          </p>
          <p>• 支持 NFO 文件元数据（poster.jpg、background.jpg）</p>
          <p>• 按需加载，无需全量扫描</p>
        </div>
      </div>

      <div className='space-y-4'>
        <div className='flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              启用小雅功能
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              关闭后将不显示小雅入口
            </p>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
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

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            Alist 服务器地址
          </label>
          <input
            type='text'
            value={serverURL}
            onChange={(e) => setServerURL(e.target.value)}
            placeholder='http://localhost:5244'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            小雅 Alist 服务器的完整地址
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            Token（推荐）
          </label>
          <input
            type='password'
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder='可选，使用 Token 认证'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
        </div>

        <div className='grid grid-cols-2 gap-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              用户名
            </label>
            <input
              type='text'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder='可选，用户名密码认证'
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
              placeholder='可选'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
        </div>

        <div className='flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              禁用预览视频
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              开启后将直接返回直连链接，不使用视频预览流
            </p>
          </div>
          <button
            onClick={() => setDisableVideoPreview(!disableVideoPreview)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              disableVideoPreview
                ? 'bg-blue-600'
                : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                disableVideoPreview ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className='flex gap-3'>
          <button
            onClick={handleTest}
            disabled={!serverURL || isLoading('testXiaoya')}
            className={buttonStyles.primary}
          >
            {isLoading('testXiaoya') ? '测试中...' : '测试连接'}
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading('saveXiaoya')}
            className={buttonStyles.success}
          >
            {isLoading('saveXiaoya') ? '保存中...' : '保存配置'}
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
