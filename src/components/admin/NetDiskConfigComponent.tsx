
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
} from '@/components/admin/shared';

export const NetDiskConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [enabled, setEnabled] = useState(false);
  const [cookie, setCookie] = useState('');
  const [savePath, setSavePath] = useState('/');
  const [quarkPlayMode, setQuarkPlayMode] = useState<
    'direct_first' | 'transcode_first'
  >('transcode_first');
  const [quarkMultiThreadPlayback, setQuarkMultiThreadPlayback] =
    useState(false);
  const [mobileEnabled, setMobileEnabled] = useState(false);
  const [mobileAuthorization, setMobileAuthorization] = useState('');
  const [baiduEnabled, setBaiduEnabled] = useState(false);
  const [baiduCookie, setBaiduCookie] = useState('');
  const [tianyiEnabled, setTianyiEnabled] = useState(false);
  const [tianyiAccount, setTianyiAccount] = useState('');
  const [tianyiPassword, setTianyiPassword] = useState('');
  const [pan123Enabled, setPan123Enabled] = useState(false);
  const [pan123Account, setPan123Account] = useState('');
  const [pan123Password, setPan123Password] = useState('');
  const [ucEnabled, setUcEnabled] = useState(false);
  const [ucCookie, setUcCookie] = useState('');
  const [ucToken, setUcToken] = useState('');
  const [ucSavePath, setUcSavePath] = useState('/');
  const [pan115Enabled, setPan115Enabled] = useState(false);
  const [pan115Cookie, setPan115Cookie] = useState('');

  useEffect(() => {
    const quark = config?.NetDiskConfig?.Quark;
    const mobile = config?.NetDiskConfig?.Mobile;
    setEnabled(quark?.Enabled || false);
    setCookie(quark?.Cookie || '');
    setSavePath(quark?.SavePath || '/');
    setQuarkPlayMode(
      quark?.PlayMode === 'direct_first' ? 'direct_first' : 'transcode_first'
    );
    setQuarkMultiThreadPlayback(Boolean(quark?.MultiThreadPlayback));
    setMobileEnabled(mobile?.Enabled || false);
    setMobileAuthorization(mobile?.Authorization || '');
    setBaiduEnabled(config?.NetDiskConfig?.Baidu?.Enabled || false);
    setBaiduCookie(config?.NetDiskConfig?.Baidu?.Cookie || '');
    setTianyiEnabled(config?.NetDiskConfig?.Tianyi?.Enabled || false);
    setTianyiAccount(config?.NetDiskConfig?.Tianyi?.Account || '');
    setTianyiPassword(config?.NetDiskConfig?.Tianyi?.Password || '');
    setPan123Enabled(config?.NetDiskConfig?.Pan123?.Enabled || false);
    setPan123Account(config?.NetDiskConfig?.Pan123?.Account || '');
    setPan123Password(config?.NetDiskConfig?.Pan123?.Password || '');
    setUcEnabled(config?.NetDiskConfig?.UC?.Enabled || false);
    setUcCookie(config?.NetDiskConfig?.UC?.Cookie || '');
    setUcToken(config?.NetDiskConfig?.UC?.Token || '');
    setUcSavePath(config?.NetDiskConfig?.UC?.SavePath || '/');
    setPan115Enabled(config?.NetDiskConfig?.Pan115?.Enabled || false);
    setPan115Cookie(config?.NetDiskConfig?.Pan115?.Cookie || '');
  }, [config]);

  const handleSave = async () => {
    await withLoading('saveNetDisk', async () => {
      const response = await fetch('/api/admin/netdisk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          Quark: {
            Enabled: enabled,
            Cookie: cookie,
            SavePath: savePath,
            PlayMode: quarkPlayMode,
            MultiThreadPlayback: quarkMultiThreadPlayback,
          },
          Mobile: {
            Enabled: mobileEnabled,
            Authorization: mobileAuthorization,
          },
          Baidu: {
            Enabled: baiduEnabled,
            Cookie: baiduCookie,
          },
          Tianyi: {
            Enabled: tianyiEnabled,
            Account: tianyiAccount,
            Password: tianyiPassword,
          },
          Pan123: {
            Enabled: pan123Enabled,
            Account: pan123Account,
            Password: pan123Password,
          },
          UC: {
            Enabled: ucEnabled,
            Cookie: ucCookie,
            Token: ucToken,
            SavePath: ucSavePath,
          },
          Pan115: {
            Enabled: pan115Enabled,
            Cookie: pan115Cookie,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '保存失败');
      }

      showSuccess('保存成功', showAlert);
      await refreshConfig();
    });
  };

  const handleValidate = async () => {
    await withLoading('validateNetDisk', async () => {
      try {
        const response = await fetch('/api/admin/netdisk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            Quark: {
              Cookie: cookie,
              SavePath: savePath,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '校验失败');
        }

        showSuccess(data.message || '夸克 Cookie 可读', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '校验失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleValidateMobile = async () => {
    await withLoading('validateMobileNetDisk', async () => {
      try {
        const response = await fetch('/api/admin/netdisk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            provider: 'mobile',
            Mobile: {
              Authorization: mobileAuthorization,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '校验失败');
        }

        showSuccess(data.message || '移动云盘验证头格式正常', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '校验失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleValidateBaidu = async () => {
    await withLoading('validateBaiduNetDisk', async () => {
      try {
        const response = await fetch('/api/admin/netdisk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            provider: 'baidu',
            Baidu: {
              Cookie: baiduCookie,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '校验失败');
        }

        showSuccess(data.message || '百度网盘 Cookie 格式正常', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '校验失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleValidateTianyi = async () => {
    await withLoading('validateTianyiNetDisk', async () => {
      try {
        const response = await fetch('/api/admin/netdisk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            provider: 'tianyi',
            Tianyi: {
              Account: tianyiAccount,
              Password: tianyiPassword,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '校验失败');
        }

        showSuccess(data.message || '天翼云盘账号密码可用', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '校验失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleValidatePan123 = async () => {
    await withLoading('validatePan123NetDisk', async () => {
      try {
        const response = await fetch('/api/admin/netdisk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            provider: 'pan123',
            Pan123: {
              Account: pan123Account,
              Password: pan123Password,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '校验失败');
        }

        showSuccess(data.message || '123网盘账号密码可用', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '校验失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleValidateUC = async () => {
    await withLoading('validateUCNetDisk', async () => {
      try {
        const response = await fetch('/api/admin/netdisk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            provider: 'uc',
            UC: {
              Cookie: ucCookie,
              Token: ucToken,
              SavePath: ucSavePath,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '校验失败');
        }

        showSuccess(data.message || 'UC Cookie 可读', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '校验失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleValidatePan115 = async () => {
    await withLoading('validatePan115NetDisk', async () => {
      try {
        const response = await fetch('/api/admin/netdisk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            provider: 'pan115',
            Pan115: {
              Cookie: pan115Cookie,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '校验失败');
        }

        showSuccess(data.message || '115 Cookie 格式正常', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '校验失败',
          showAlert
        );
        throw error;
      }
    });
  };

  return (
    <div className='space-y-6'>
      <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
        <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
          夸克网盘
        </summary>
        <div className='mt-4 space-y-4'>
          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                启用夸克网盘
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，网盘搜索中的夸克资源会显示“立即播放”和“转存”按钮
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              Cookie
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              disabled={!enabled}
              rows={5}
              placeholder='粘贴夸克网盘 Cookie'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              转存位置
            </label>
            <input
              type='text'
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              disabled={!enabled}
              placeholder='/影视/正式转存'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              播放方式
            </label>
            <select
              value={quarkPlayMode}
              onChange={(e) =>
                setQuarkPlayMode(
                  e.target.value === 'transcode_first'
                    ? 'transcode_first'
                    : 'direct_first'
                )
              }
              disabled={!enabled}
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            >
              <option value='direct_first'>直链优先</option>
              <option value='transcode_first'>转码优先</option>
            </select>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              直链优先会优先使用原画下载地址；转码优先会优先使用夸克转码播放地址。
            </p>
          </div>

          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                多线程播放
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，代理会把播放器请求的 Range 拆分并发拉取。
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={quarkMultiThreadPlayback}
                onChange={(e) => setQuarkMultiThreadPlayback(e.target.checked)}
                disabled={!enabled}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-disabled:opacity-50 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className='flex gap-3'>
            <button
              onClick={handleValidate}
              disabled={!enabled || !cookie || isLoading('validateNetDisk')}
              className={buttonStyles.primary}
            >
              {isLoading('validateNetDisk') ? '校验中...' : '校验夸克配置'}
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading('saveNetDisk')}
              className={buttonStyles.success}
            >
              {isLoading('saveNetDisk') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </details>

      <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
        <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
          移动云盘
        </summary>
        <div className='mt-4 space-y-4'>
          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                启用移动云盘
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，网盘搜索中的移动云盘资源会显示“立即播放”按钮
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={mobileEnabled}
                onChange={(e) => setMobileEnabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-pink-300 dark:peer-focus:ring-pink-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-pink-600"></div>
            </label>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              验证头
            </label>
            <textarea
              value={mobileAuthorization}
              onChange={(e) => setMobileAuthorization(e.target.value)}
              disabled={!mobileEnabled}
              rows={5}
              placeholder='粘贴移动云盘验证头'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-pink-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div className='flex gap-3'>
            <button
              onClick={handleValidateMobile}
              disabled={
                !mobileEnabled ||
                !mobileAuthorization ||
                isLoading('validateMobileNetDisk')
              }
              className={buttonStyles.primary}
            >
              {isLoading('validateMobileNetDisk')
                ? '校验中...'
                : '校验移动云盘验证头'}
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading('saveNetDisk')}
              className={buttonStyles.success}
            >
              {isLoading('saveNetDisk') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </details>

      <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
        <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
          百度网盘
        </summary>
        <div className='mt-4 space-y-4'>
          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                启用百度网盘
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，网盘搜索中的百度网盘资源会显示“立即播放”按钮
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={baiduEnabled}
                onChange={(e) => setBaiduEnabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-sky-300 dark:peer-focus:ring-sky-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-sky-600"></div>
            </label>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              Cookie
            </label>
            <textarea
              value={baiduCookie}
              onChange={(e) => setBaiduCookie(e.target.value)}
              disabled={!baiduEnabled}
              rows={5}
              placeholder='粘贴百度网盘 Cookie'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div className='flex gap-3'>
            <button
              onClick={handleValidateBaidu}
              disabled={
                !baiduEnabled ||
                !baiduCookie ||
                isLoading('validateBaiduNetDisk')
              }
              className={buttonStyles.primary}
            >
              {isLoading('validateBaiduNetDisk')
                ? '校验中...'
                : '校验百度网盘 Cookie'}
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading('saveNetDisk')}
              className={buttonStyles.success}
            >
              {isLoading('saveNetDisk') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </details>

      <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
        <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
          天翼云盘
        </summary>
        <div className='mt-4 space-y-4'>
          <div className='rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'>
            使用天翼云盘前，请先关闭账号的设备锁，否则可能无法登录。
          </div>

          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                启用天翼云盘
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，网盘搜索中的天翼云盘资源会显示“立即播放”按钮
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={tianyiEnabled}
                onChange={(e) => setTianyiEnabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-red-300 dark:peer-focus:ring-red-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-red-600"></div>
            </label>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              账号
            </label>
            <input
              type='text'
              value={tianyiAccount}
              onChange={(e) => setTianyiAccount(e.target.value)}
              disabled={!tianyiEnabled}
              placeholder='手机号 / 邮箱 / 天翼账号'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              密码
            </label>
            <input
              type='password'
              value={tianyiPassword}
              onChange={(e) => setTianyiPassword(e.target.value)}
              disabled={!tianyiEnabled}
              placeholder='输入天翼云盘密码'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div className='flex gap-3'>
            <button
              onClick={handleValidateTianyi}
              disabled={
                !tianyiEnabled ||
                !tianyiAccount ||
                !tianyiPassword ||
                isLoading('validateTianyiNetDisk')
              }
              className={buttonStyles.primary}
            >
              {isLoading('validateTianyiNetDisk')
                ? '校验中...'
                : '校验天翼云盘账号密码'}
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading('saveNetDisk')}
              className={buttonStyles.success}
            >
              {isLoading('saveNetDisk') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </details>

      <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
        <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
          123网盘
        </summary>
        <div className='mt-4 space-y-4'>
          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                启用123网盘
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，网盘搜索中的123网盘资源会显示“立即播放”按钮
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={pan123Enabled}
                onChange={(e) => setPan123Enabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-teal-300 dark:peer-focus:ring-teal-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-teal-600"></div>
            </label>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              账号
            </label>
            <input
              type='text'
              value={pan123Account}
              onChange={(e) => setPan123Account(e.target.value)}
              disabled={!pan123Enabled}
              placeholder='输入123网盘账号'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              密码
            </label>
            <input
              type='password'
              value={pan123Password}
              onChange={(e) => setPan123Password(e.target.value)}
              disabled={!pan123Enabled}
              placeholder='输入123网盘密码'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div className='flex gap-3'>
            <button
              onClick={handleValidatePan123}
              disabled={
                !pan123Enabled ||
                !pan123Account ||
                !pan123Password ||
                isLoading('validatePan123NetDisk')
              }
              className={buttonStyles.primary}
            >
              {isLoading('validatePan123NetDisk')
                ? '校验中...'
                : '校验123网盘账号密码'}
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading('saveNetDisk')}
              className={buttonStyles.success}
            >
              {isLoading('saveNetDisk') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </details>

      <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
        <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
          UC网盘
        </summary>
        <div className='mt-4 space-y-4'>
          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                启用UC网盘
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，网盘搜索中的UC网盘资源会显示“立即播放”按钮
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={ucEnabled}
                onChange={(e) => setUcEnabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-green-600"></div>
            </label>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              Cookie
            </label>
            <textarea
              value={ucCookie}
              onChange={(e) => setUcCookie(e.target.value)}
              disabled={!ucEnabled}
              rows={5}
              placeholder='粘贴 UC 网盘 Cookie'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              Open API Token（可选）
            </label>
            <input
              type='text'
              value={ucToken}
              onChange={(e) => setUcToken(e.target.value)}
              disabled={!ucEnabled}
              placeholder='可选，填写后优先尝试原画地址'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              临时转存位置
            </label>
            <input
              type='text'
              value={ucSavePath}
              onChange={(e) => setUcSavePath(e.target.value)}
              disabled={!ucEnabled}
              placeholder='/影视/UC临时转存'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div className='flex gap-3'>
            <button
              onClick={handleValidateUC}
              disabled={
                !ucEnabled || !ucCookie || isLoading('validateUCNetDisk')
              }
              className={buttonStyles.primary}
            >
              {isLoading('validateUCNetDisk') ? '校验中...' : '校验UC配置'}
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading('saveNetDisk')}
              className={buttonStyles.success}
            >
              {isLoading('saveNetDisk') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </details>

      <details className='pt-4 border-t border-gray-200 dark:border-gray-700'>
        <summary className='text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer'>
          115网盘
        </summary>
        <div className='mt-4 space-y-4'>
          <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                启用115网盘
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，网盘搜索中的115网盘资源会显示“立即播放”按钮
              </p>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={pan115Enabled}
                onChange={(e) => setPan115Enabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-amber-300 dark:peer-focus:ring-amber-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-600"></div>
            </label>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              Cookie
            </label>
            <textarea
              value={pan115Cookie}
              onChange={(e) => setPan115Cookie(e.target.value)}
              disabled={!pan115Enabled}
              rows={5}
              placeholder='粘贴115网盘 Cookie'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>

          <div className='flex gap-3'>
            <button
              onClick={handleValidatePan115}
              disabled={
                !pan115Enabled ||
                !pan115Cookie ||
                isLoading('validatePan115NetDisk')
              }
              className={buttonStyles.primary}
            >
              {isLoading('validatePan115NetDisk')
                ? '校验中...'
                : '校验115 Cookie'}
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading('saveNetDisk')}
              className={buttonStyles.success}
            >
              {isLoading('saveNetDisk') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </details>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
        onConfirm={alertModal.onConfirm}
      />
    </div>
  );
};
