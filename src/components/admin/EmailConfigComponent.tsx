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

export const EmailConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<'smtp' | 'resend'>('smtp');

  // SMTP配置
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');

  // Resend配置
  const [resendApiKey, setResendApiKey] = useState('');
  const [resendFrom, setResendFrom] = useState('');

  // 测试邮件
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    if (config?.EmailConfig) {
      setEnabled(config.EmailConfig.enabled || false);
      setProvider(config.EmailConfig.provider || 'smtp');

      if (config.EmailConfig.smtp) {
        setSmtpHost(config.EmailConfig.smtp.host || '');
        setSmtpPort(config.EmailConfig.smtp.port || 587);
        setSmtpSecure(config.EmailConfig.smtp.secure || false);
        setSmtpUser(config.EmailConfig.smtp.user || '');
        setSmtpPassword(config.EmailConfig.smtp.password || '');
        setSmtpFrom(config.EmailConfig.smtp.from || '');
      }

      if (config.EmailConfig.resend) {
        setResendApiKey(config.EmailConfig.resend.apiKey || '');
        setResendFrom(config.EmailConfig.resend.from || '');
      }
    }
  }, [config]);

  const handleSave = async () => {
    await withLoading('saveEmail', async () => {
      try {
        const emailConfig: AdminConfig['EmailConfig'] = {
          enabled,
          provider,
          smtp:
            provider === 'smtp'
              ? {
                  host: smtpHost,
                  port: smtpPort,
                  secure: smtpSecure,
                  user: smtpUser,
                  password: smtpPassword,
                  from: smtpFrom,
                }
              : undefined,
          resend:
            provider === 'resend'
              ? {
                  apiKey: resendApiKey,
                  from: resendFrom,
                }
              : undefined,
        };

        const response = await fetch('/api/admin/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            config: emailConfig,
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
    if (!testEmail) {
      showError('请输入测试邮箱地址', showAlert);
      return;
    }

    await withLoading('testEmail', async () => {
      try {
        const emailConfig: AdminConfig['EmailConfig'] = {
          enabled: true,
          provider,
          smtp:
            provider === 'smtp'
              ? {
                  host: smtpHost,
                  port: smtpPort,
                  secure: smtpSecure,
                  user: smtpUser,
                  password: smtpPassword,
                  from: smtpFrom,
                }
              : undefined,
          resend:
            provider === 'resend'
              ? {
                  apiKey: resendApiKey,
                  from: resendFrom,
                }
              : undefined,
        };

        const response = await fetch('/api/admin/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'test',
            config: emailConfig,
            testEmail,
          }),
        });

        const data = await response.json();
        if (data.success) {
          showSuccess('测试邮件发送成功，请检查收件箱', showAlert);
        } else {
          showError(data.error || '发送失败', showAlert);
        }
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '发送失败',
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
          关于邮件通知
        </h3>
        <div className='text-sm text-blue-800 dark:text-blue-200 space-y-1'>
          <p>• 当用户收藏的影片有更新时，自动发送邮件通知</p>
          <p>• 支持 SMTP 和 Resend 两种发送方式</p>
          <p>• 用户可在个人设置中配置邮箱和通知偏好</p>
        </div>
      </div>

      <div className='space-y-4'>
        {/* 启用开关 */}
        <div className='flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              启用邮件通知
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              开启后用户可以接收收藏更新的邮件通知
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

        {/* 发送方式选择 */}
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            发送方式
          </label>
          <div className='flex gap-4'>
            <label className='flex items-center'>
              <input
                type='radio'
                value='smtp'
                checked={provider === 'smtp'}
                onChange={(e) => setProvider(e.target.value as 'smtp')}
                className='mr-2'
              />
              <span className='text-sm text-gray-700 dark:text-gray-300'>
                SMTP
              </span>
            </label>
            <label className='flex items-center'>
              <input
                type='radio'
                value='resend'
                checked={provider === 'resend'}
                onChange={(e) => setProvider(e.target.value as 'resend')}
                className='mr-2'
              />
              <span className='text-sm text-gray-700 dark:text-gray-300'>
                Resend
              </span>
            </label>
          </div>
        </div>

        {/* SMTP配置 */}
        {provider === 'smtp' && (
          <div className='space-y-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <h4 className='text-sm font-medium text-gray-900 dark:text-white'>
              SMTP 配置
            </h4>

            <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                  SMTP 主机 *
                </label>
                <input
                  type='text'
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder='smtp.gmail.com'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                />
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                  SMTP 端口 *
                </label>
                <input
                  type='number'
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(parseInt(e.target.value))}
                  placeholder='587'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
                />
              </div>
            </div>

            <div className='flex items-center'>
              <input
                type='checkbox'
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
                className='mr-2'
              />
              <label className='text-sm text-gray-700 dark:text-gray-300'>
                使用 SSL/TLS（端口 465 时启用）
              </label>
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                SMTP 用户名 *
              </label>
              <input
                type='text'
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder='your-email@gmail.com'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
              />
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                SMTP 密码 *
              </label>
              <input
                type='password'
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                placeholder='应用专用密码'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
              />
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                发件人邮箱 *
              </label>
              <input
                type='email'
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                placeholder='noreply@yourdomain.com'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
              />
            </div>
          </div>
        )}

        {/* Resend配置 */}
        {provider === 'resend' && (
          <div className='space-y-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <h4 className='text-sm font-medium text-gray-900 dark:text-white'>
              Resend 配置
            </h4>

            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                Resend API Key *
              </label>
              <input
                type='password'
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                placeholder='re_xxxxx'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
              />
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                在{' '}
                <a
                  href='https://resend.com/api-keys'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-600 hover:underline'
                >
                  Resend 控制台
                </a>{' '}
                获取
              </p>
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                发件人邮箱 *
              </label>
              <input
                type='email'
                value={resendFrom}
                onChange={(e) => setResendFrom(e.target.value)}
                placeholder='noreply@yourdomain.com'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white'
              />
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                需要先在 Resend 中验证域名
              </p>
            </div>
          </div>
        )}

        {/* 测试邮件 */}
        <div className='p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg'>
          <h4 className='text-sm font-medium text-blue-900 dark:text-blue-100 mb-2'>
            发送测试邮件
          </h4>
          <div className='flex flex-col sm:flex-row gap-2'>
            <input
              type='email'
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder='输入测试邮箱地址'
              className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm'
            />
            <button
              onClick={handleTest}
              disabled={isLoading('testEmail') || !testEmail}
              className={`${buttonStyles.primary} whitespace-nowrap`}
            >
              {isLoading('testEmail') ? '发送中...' : '发送测试'}
            </button>
          </div>
        </div>

        {/* 保存按钮 */}
        <div className='flex gap-3'>
          <button
            onClick={handleSave}
            disabled={isLoading('saveEmail')}
            className={buttonStyles.success}
          >
            {isLoading('saveEmail') ? '保存中...' : '保存配置'}
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
