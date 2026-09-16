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

export const TelegramConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [apiProxy, setApiProxy] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [loginEnabled, setLoginEnabled] = useState(true);
  const [bindingEnabled, setBindingEnabled] = useState(true);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [defaultNotifications, setDefaultNotifications] = useState(true);
  const [testChatId, setTestChatId] = useState('');

  useEffect(() => {
    const telegram = config?.TelegramConfig;
    if (telegram) {
      setEnabled(Boolean(telegram.enabled));
      setBotToken(telegram.botToken || '');
      setBotUsername(telegram.botUsername || '');
      setWebhookSecret(telegram.webhookSecret || '');
      setApiProxy(telegram.apiProxy || '');
      setApiBaseUrl(telegram.apiBaseUrl || '');
      setLoginEnabled(telegram.loginEnabled !== false);
      setBindingEnabled(telegram.bindingEnabled !== false);
      setRegistrationEnabled(telegram.registrationEnabled === true);
      setNotificationsEnabled(telegram.notificationsEnabled !== false);
      setDefaultNotifications(telegram.defaultNotifications !== false);
    }
  }, [config]);

  const buildConfig = (): AdminConfig['TelegramConfig'] => ({
    enabled,
    botToken,
    botUsername: botUsername.replace(/^@/, ''),
    webhookSecret,
    apiProxy,
    apiBaseUrl,
    loginEnabled,
    bindingEnabled,
    registrationEnabled,
    notificationsEnabled,
    defaultNotifications,
  });

  const handleSave = async () => {
    await withLoading('saveTelegram', async () => {
      try {
        const response = await fetch('/api/admin/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', config: buildConfig() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '保存失败');
        showSuccess('Telegram 配置保存成功', showAlert);
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

  const handleSetWebhook = async () => {
    await withLoading('setTelegramWebhook', async () => {
      try {
        if (!enabled) {
          throw new Error('请先开启 Telegram Bot');
        }
        if (!botToken.trim() || !botUsername.trim() || !webhookSecret.trim()) {
          throw new Error('请先填写 Bot Token、Bot 用户名 和 Webhook Secret');
        }

        const webhookUrlValue =
          webhookSecret === '******'
            ? ''
            : `${window.location.origin}/api/telegram/webhook/${webhookSecret}`;
        const response = await fetch('/api/admin/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_webhook',
            config: buildConfig(),
            webhookUrl: webhookUrlValue,
            origin: window.location.origin,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const telegramDetail = data.telegram
            ? `（HTTP ${data.telegram.status || '-'}，响应：${
                data.telegram.body || data.telegram.statusText || '-'
              }）`
            : '';
          throw new Error(
            `${data.error || 'Webhook 设置失败'}${telegramDetail}`
          );
        }
        showSuccess('Webhook 设置成功', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : 'Webhook 设置失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleTest = async () => {
    if (!testChatId.trim()) {
      showError('请输入测试 Chat ID', showAlert);
      return;
    }

    await withLoading('testTelegram', async () => {
      try {
        const response = await fetch('/api/admin/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'test',
            config: buildConfig(),
            testChatId: testChatId.trim(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '发送失败');
        showSuccess('测试消息发送成功', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '发送失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const webhookUrl = webhookSecret
    ? `${
        typeof window !== 'undefined' ? window.location.origin : ''
      }/api/telegram/webhook/${
        webhookSecret === '******' ? '<secret>' : webhookSecret
      }`
    : '';

  return (
    <div className='space-y-6'>
      <div className='bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4'>
        <h3 className='text-sm font-medium text-sky-900 dark:text-sky-100 mb-2'>
          关于 Telegram Bot
        </h3>
        <div className='text-sm text-sky-800 dark:text-sky-200 space-y-1'>
          <p>• 支持用户绑定 Telegram、快捷确认登录和站内通知推送</p>
          <p>
            • 开启 Telegram 注册后，用户可在 Bot 中发送 /register 用户名 密码
            注册账号
          </p>
          <p>• Webhook 地址需在 Telegram Bot API 中手动设置</p>
          <p>• Bot Token 和 Webhook Secret 仅服务端保存，不会暴露给前端</p>
        </div>
      </div>

      <div className='space-y-4'>
        <div className='flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              启用 Telegram Bot
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              开启后显示绑定与 Telegram 登录入口
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

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              Bot Token *
            </label>
            <input
              type='password'
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder='123456:ABC...'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
            />
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              Bot 用户名 *
            </label>
            <input
              type='text'
              value={botUsername}
              onChange={(e) => setBotUsername(e.target.value)}
              placeholder='your_bot'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
            />
          </div>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            Webhook Secret
          </label>
          <input
            type='password'
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder='建议填写随机长字符串'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
          />
          {webhookUrl && (
            <p className='mt-2 break-all text-xs text-gray-500 dark:text-gray-400'>
              Webhook URL：{webhookUrl}
            </p>
          )}
          <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
            <button
              onClick={handleSetWebhook}
              disabled={isLoading('setTelegramWebhook')}
              className={`w-full sm:w-auto ${buttonStyles.primary}`}
            >
              {isLoading('setTelegramWebhook')
                ? '设置中...'
                : '一键设置 Webhook'}
            </button>
          </div>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              系统代理
            </label>
            <input
              type='text'
              value={apiProxy}
              onChange={(e) => setApiProxy(e.target.value)}
              placeholder='http://127.0.0.1:7890'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              Node 部署可用；Cloudflare/Edge 环境会忽略。
            </p>
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              反代 Base URL
            </label>
            <input
              type='text'
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder='https://telegram-api.example.com'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              用于替换 https://api.telegram.org。
            </p>
          </div>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
          {[
            ['允许绑定', bindingEnabled, setBindingEnabled],
            ['允许 Telegram 注册', registrationEnabled, setRegistrationEnabled],
            ['允许 Telegram 登录', loginEnabled, setLoginEnabled],
            [
              '启用 Telegram 通知',
              notificationsEnabled,
              setNotificationsEnabled,
            ],
            [
              '新绑定默认开启通知',
              defaultNotifications,
              setDefaultNotifications,
            ],
          ].map(([label, value, setter]) => (
            <label
              key={label as string}
              className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'
            >
              <input
                type='checkbox'
                checked={value as boolean}
                onChange={(e) =>
                  (setter as (value: boolean) => void)(e.target.checked)
                }
              />
              {label as string}
            </label>
          ))}
        </div>

        <div className='rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            测试 Chat ID
          </label>
          <div className='flex flex-col gap-2 sm:flex-row'>
            <input
              type='text'
              value={testChatId}
              onChange={(e) => setTestChatId(e.target.value)}
              placeholder='用户或群组 chat_id'
              className='min-w-0 flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
            />
            <button
              onClick={handleTest}
              disabled={isLoading('testTelegram')}
              className={`w-full shrink-0 sm:w-auto ${buttonStyles.primary}`}
            >
              {isLoading('testTelegram') ? '发送中...' : '测试'}
            </button>
          </div>
        </div>

        <div className='flex justify-end'>
          <button
            onClick={handleSave}
            disabled={isLoading('saveTelegram')}
            className={buttonStyles.success}
          >
            {isLoading('saveTelegram') ? '保存中...' : '保存配置'}
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
