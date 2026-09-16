/* eslint-disable no-console,react-hooks/exhaustive-deps */

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

export const CustomAdFilterConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [adFilterCode, setAdFilterCode] = useState('');

  // 默认去广告代码
  const defaultAdFilterCode = `function filterAdsFromM3U8(type: string, m3u8Content: string): string {
  if (!m3u8Content) return '';

  // 广告关键字列表
  const adKeywords = [
    'sponsor',
    '/ad/',
    '/ads/',
    'advert',
    'advertisement',
    '/adjump',
    'redtraffic'
  ];

  // 按行分割M3U8内容
  const lines = m3u8Content.split('\\n');
  const filteredLines = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 跳过 #EXT-X-DISCONTINUITY 标识
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      i++;
      continue;
    }

    // 如果是 EXTINF 行，检查下一行 URL 是否包含广告关键字
    if (line.includes('#EXTINF:')) {
      // 检查下一行 URL 是否包含广告关键字
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const containsAdKeyword = adKeywords.some(keyword =>
          nextLine.toLowerCase().includes(keyword.toLowerCase())
        );

        if (containsAdKeyword) {
          // 跳过 EXTINF 行和 URL 行
          i += 2;
          continue;
        }
      }
    }

    // 保留当前行
    filteredLines.push(line);
    i++;
  }

  return filteredLines.join('\\n');
}`;

  useEffect(() => {
    // 从数据库配置读取自定义去广告代码
    if (config?.SiteConfig?.CustomAdFilterCode) {
      setAdFilterCode(config.SiteConfig.CustomAdFilterCode);
    } else {
      // 如果数据库没有保存的代码，使用默认代码
      setAdFilterCode(defaultAdFilterCode);
    }
  }, [config]);

  // 移除 TypeScript 类型注解，转换为纯 JavaScript
  const removeTypeAnnotations = (code: string): string => {
    return (
      code
        // 移除函数参数的类型注解：name: type
        .replace(
          /(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g,
          '$1$3'
        )
        // 移除函数返回值类型注解：): type {
        .replace(
          /\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g,
          ') {'
        )
        // 移除变量声明的类型注解：const name: type =
        .replace(
          /(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g,
          '$1 $2 ='
        )
    );
  };

  // 保存自定义去广告代码
  const handleSave = async () => {
    await withLoading('saveAdFilterCode', async () => {
      try {
        // 验证代码语法
        try {
          // 移除类型注解后验证
          const jsCode = removeTypeAnnotations(adFilterCode);
          // 使用 Function 构造器验证代码是否可以解析
          new Function(
            'type',
            'm3u8Content',
            jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
          );
        } catch (parseError) {
          console.error('代码验证失败:', parseError);
          showError(
            '代码语法错误：' +
              (parseError instanceof Error
                ? parseError.message
                : '请检查代码格式'),
            showAlert
          );
          return;
        }

        // 更新配置到数据库
        if (!config) {
          showError('配置未加载', showAlert);
          return;
        }

        // 准备更新的站点配置，包含自定义去广告代码
        const updatedSiteConfig = {
          ...config.SiteConfig,
          CustomAdFilterCode: adFilterCode,
          CustomAdFilterVersion: Date.now(), // 使用时间戳作为版本号
        };

        const response = await fetch('/api/admin/site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedSiteConfig),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '保存配置失败');
        }

        // 刷新配置
        await refreshConfig();

        showSuccess('去广告代码保存成功，刷新后生效', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
  };

  // 重置为默认代码
  const handleReset = () => {
    setAdFilterCode(defaultAdFilterCode);
    showSuccess('已重置为默认代码', showAlert);
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* 说明区域 */}
      <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
        <div className='flex items-center space-x-2 mb-2'>
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
              d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
            />
          </svg>
          <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
            使用说明
          </span>
        </div>
        <div className='text-sm text-blue-700 dark:text-blue-400 space-y-1'>
          <p>• 此功能用于自定义 M3U8 播放列表的去广告逻辑</p>
          <p>• 配置保存到数据库，对全平台所有用户生效</p>
          <p>
            • 客户端会自动缓存代码，只在版本更新时重新获取，不会频繁请求服务器
          </p>
          <p>
            • 函数签名必须为:{' '}
            <code className='bg-blue-100 dark:bg-blue-900/40 px-1 rounded-sm'>
              filterAdsFromM3U8(type, m3u8Content)
            </code>
          </p>
          <p>• type 参数为视频源类型，m3u8Content 为播放列表内容</p>
          <p>• 函数需要返回处理后的 M3U8 内容</p>
          <p>• 支持 TypeScript 类型注解，保存时会自动转换为 JavaScript</p>
        </div>
      </div>

      {/* 代码编辑区域 */}
      <div className='space-y-3'>
        <div className='flex items-center justify-between'>
          <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            自定义去广告代码
          </label>
          <button
            onClick={handleReset}
            className={`${buttonStyles.secondarySmall}`}
          >
            重置为默认
          </button>
        </div>
        <div className='relative'>
          <textarea
            value={adFilterCode}
            onChange={(e) => setAdFilterCode(e.target.value)}
            rows={25}
            placeholder='请输入自定义去广告代码...'
            className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500'
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
            }}
            spellCheck={false}
            data-gramm={false}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div className='text-xs text-gray-500 dark:text-gray-400'>
            修改后需保存才能生效，保存前会进行语法验证
          </div>
          <button
            onClick={handleSave}
            disabled={isLoading('saveAdFilterCode')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              isLoading('saveAdFilterCode')
                ? buttonStyles.disabled
                : buttonStyles.success
            }`}
          >
            {isLoading('saveAdFilterCode') ? '保存中…' : '保存'}
          </button>
        </div>
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
    </div>
  );
};
