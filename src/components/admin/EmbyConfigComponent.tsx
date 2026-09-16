/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Fragment, useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';
import { CURRENT_VERSION } from '@/lib/version';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

export const EmbyConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();

  // 源列表状态
  const [sources, setSources] = useState<any[]>([]);
  const [editingSource, setEditingSource] = useState<any | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );

  // 表单状态
  const [formData, setFormData] = useState({
    key: '',
    name: '',
    enabled: true,
    ServerURL: '',
    ApiKey: '',
    Username: '',
    Password: '',
    UserId: '',
    isDefault: false,
    // 高级选项
    removeEmbyPrefix: false,
    appendMediaSourceId: false,
    transcodeMp4: false,
    proxyPlay: false,
    customUserAgent: '',
    embyAuthorizationHeader: '',
  });
  const [authMode, setAuthMode] = useState<'apikey' | 'password'>('apikey');

  // 从配置加载源列表
  useEffect(() => {
    if (config?.EmbyConfig?.Sources) {
      setSources(config.EmbyConfig.Sources);
    } else if (config?.EmbyConfig?.ServerURL) {
      // 兼容旧格式
      setSources([
        {
          key: 'default',
          name: 'Emby',
          enabled: config.EmbyConfig.Enabled || false,
          ServerURL: config.EmbyConfig.ServerURL,
          ApiKey: config.EmbyConfig.ApiKey,
          Username: config.EmbyConfig.Username,
          Password: config.EmbyConfig.Password,
          UserId: config.EmbyConfig.UserId,
          embyAuthorizationHeader: config.EmbyConfig.embyAuthorizationHeader,
          isDefault: true,
        },
      ]);
    }
  }, [config]);

  // 重置表单
  const resetForm = () => {
    setFormData({
      key: '',
      name: '',
      enabled: true,
      ServerURL: '',
      ApiKey: '',
      Username: '',
      Password: '',
      UserId: '',
      isDefault: false,
      // 高级选项
      removeEmbyPrefix: false,
      appendMediaSourceId: false,
      transcodeMp4: false,
      proxyPlay: false,
      customUserAgent: '',
      embyAuthorizationHeader: '',
    });
    setAuthMode('apikey');
    setEditingSource(null);
    setShowAddForm(false);
  };

  // 开始编辑
  const handleEdit = (source: any) => {
    setFormData({ ...source });
    // 根据现有配置判断认证方式
    if (source.ApiKey) {
      setAuthMode('apikey');
    } else if (source.Username) {
      setAuthMode('password');
    } else {
      setAuthMode('apikey');
    }
    setEditingSource(source);
    setShowAddForm(false);
  };

  // 开始添加
  const handleAdd = () => {
    resetForm();
    setShowAddForm(true);
  };

  // 保存源（添加或更新）
  const handleSave = async () => {
    // 验证必填字段
    if (!formData.key || !formData.name || !formData.ServerURL) {
      showError('请填写必填字段：标识符、名称、服务器地址', showAlert);
      return;
    }

    // 根据认证方式验证必填字段
    if (authMode === 'apikey') {
      if (!formData.ApiKey || !formData.UserId) {
        showError('使用密钥认证时，API Key 和用户 ID 为必填项', showAlert);
        return;
      }
    } else if (authMode === 'password') {
      if (!formData.Username) {
        showError('使用账号认证时，用户名为必填项', showAlert);
        return;
      }
    }

    // 验证key唯一性
    if (!editingSource && sources.some((s) => s.key === formData.key)) {
      showError('标识符已存在，请使用其他标识符', showAlert);
      return;
    }

    await withLoading('saveEmbySource', async () => {
      try {
        let newSources;
        if (editingSource) {
          // 更新现有源
          newSources = sources.map((s) =>
            s.key === editingSource.key ? formData : s
          );
        } else {
          // 添加新源
          newSources = [...sources, formData];
        }

        // 保存到配置
        const response = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            EmbyConfig: {
              Sources: newSources,
            },
          }),
        });

        if (!response.ok) {
          throw new Error('保存失败');
        }

        await refreshConfig();
        resetForm();
        showSuccess(editingSource ? '更新成功' : '添加成功', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '保存失败',
          showAlert
        );
      }
    });
  };

  // 删除源
  const handleDelete = async (source: any) => {
    if (!confirm(`确定要删除 "${source.name}" 吗？`)) {
      return;
    }

    await withLoading('deleteEmbySource', async () => {
      try {
        const newSources = sources.filter((s) => s.key !== source.key);

        const response = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            EmbyConfig: {
              Sources: newSources,
            },
          }),
        });

        if (!response.ok) {
          throw new Error('删除失败');
        }

        await refreshConfig();
        showSuccess('删除成功', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '删除失败',
          showAlert
        );
      }
    });
  };

  // 切换启用状态
  const handleToggleEnabled = async (source: any) => {
    await withLoading('toggleEmbySource', async () => {
      try {
        const newSources = sources.map((s) =>
          s.key === source.key ? { ...s, enabled: !s.enabled } : s
        );

        const response = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            EmbyConfig: {
              Sources: newSources,
            },
          }),
        });

        if (!response.ok) {
          throw new Error('更新失败');
        }

        await refreshConfig();
        showSuccess(source.enabled ? '已禁用' : '已启用', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '更新失败',
          showAlert
        );
      }
    });
  };

  // 测试连接
  const handleTest = async (source: any) => {
    await withLoading('testEmbySource', async () => {
      try {
        const response = await fetch('/api/admin/emby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'test',
            ServerURL: source.ServerURL,
            ApiKey: source.ApiKey,
            Username: source.Username,
            Password: source.Password,
            embyAuthorizationHeader: source.embyAuthorizationHeader,
          }),
        });

        const data = await response.json();

        if (data.success) {
          showSuccess(data.message || 'Emby 连接测试成功', showAlert);
        } else {
          showError(data.message || 'Emby 连接测试失败', showAlert);
        }
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '测试失败',
          showAlert
        );
      }
    });
  };

  // 清除缓存
  const handleClearCache = async () => {
    await withLoading('clearEmbyCache', async () => {
      try {
        const response = await fetch('/api/admin/emby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'clearCache',
          }),
        });

        const data = await response.json();

        if (data.success) {
          showSuccess(data.message || '缓存清除成功', showAlert);
        } else {
          showError(data.message || '缓存清除失败', showAlert);
        }
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '缓存清除失败',
          showAlert
        );
      }
    });
  };

  // 导出配置
  const handleExport = async () => {
    await withLoading('exportEmby', async () => {
      try {
        const response = await fetch('/api/admin/emby/export');
        if (!response.ok) {
          const data = await response.json();
          showError(data.error || '导出失败', showAlert);
          return;
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `emby-config-${Date.now()}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
        showSuccess('导出成功', showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '导出失败',
          showAlert
        );
      }
    });
  };

  // 导入配置
  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      await withLoading('importEmby', async () => {
        try {
          const text = await file.text();
          const data = JSON.parse(text);

          const response = await fetch('/api/admin/emby/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data }),
          });

          const result = await response.json();

          if (result.success) {
            showSuccess('导入成功', showAlert);
            await refreshConfig();
          } else {
            showError(result.error || '导入失败', showAlert);
          }
        } catch (error) {
          showError(
            error instanceof Error ? error.message : '导入失败',
            showAlert
          );
        }
      });
    };
    input.click();
  };

  // 批量启用
  const handleBatchEnable = async () => {
    if (selectedSources.size === 0) return;
    await withLoading('batchEnableEmby', async () => {
      try {
        const newSources = sources.map((s) =>
          selectedSources.has(s.key) ? { ...s, enabled: true } : s
        );
        const response = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            EmbyConfig: { Sources: newSources },
          }),
        });
        if (!response.ok) throw new Error('批量启用失败');
        await refreshConfig();
        setSelectedSources(new Set());
        showSuccess(`已启用 ${selectedSources.size} 个源`, showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '批量启用失败',
          showAlert
        );
      }
    });
  };

  // 批量禁用
  const handleBatchDisable = async () => {
    if (selectedSources.size === 0) return;
    await withLoading('batchDisableEmby', async () => {
      try {
        const newSources = sources.map((s) =>
          selectedSources.has(s.key) ? { ...s, enabled: false } : s
        );
        const response = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            EmbyConfig: { Sources: newSources },
          }),
        });
        if (!response.ok) throw new Error('批量禁用失败');
        await refreshConfig();
        setSelectedSources(new Set());
        showSuccess(`已禁用 ${selectedSources.size} 个源`, showAlert);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '批量禁用失败',
          showAlert
        );
      }
    });
  };

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedSources.size === 0) return;
    showAlert({
      type: 'warning',
      title: '确认批量删除',
      message: `确定要删除选中的 ${selectedSources.size} 个源吗？此操作不可恢复。`,
      showConfirm: true,
      onConfirm: async () => {
        await withLoading('batchDeleteEmby', async () => {
          try {
            const newSources = sources.filter(
              (s) => !selectedSources.has(s.key)
            );
            const response = await fetch('/api/admin/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                EmbyConfig: { Sources: newSources },
              }),
            });
            if (!response.ok) throw new Error('批量删除失败');
            await refreshConfig();
            setSelectedSources(new Set());
            showSuccess(`已删除 ${selectedSources.size} 个源`, showAlert);
          } catch (error) {
            showError(
              error instanceof Error ? error.message : '批量删除失败',
              showAlert
            );
          }
        });
      },
    });
  };

  return (
    <div className='space-y-6'>
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

      {/* 源列表 */}
      <div className='space-y-4'>
        <div className='flex items-center justify-between'>
          <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
            Emby 源列表 ({sources.length})
          </h3>
          <div className='flex gap-2'>
            <button onClick={handleAdd} className={buttonStyles.success}>
              添加新源
            </button>
          </div>
        </div>

        {selectedSources.size > 0 && (
          <div className='flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg'>
            <span className='text-sm text-gray-700 dark:text-gray-300'>
              已选择 {selectedSources.size} 项
            </span>
            <button
              onClick={handleBatchEnable}
              disabled={isLoading('batchEnableEmby')}
              className={buttonStyles.successSmall}
            >
              批量启用
            </button>
            <button
              onClick={handleBatchDisable}
              disabled={isLoading('batchDisableEmby')}
              className={buttonStyles.warningSmall}
            >
              批量禁用
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={isLoading('batchDeleteEmby')}
              className={buttonStyles.dangerSmall}
            >
              批量删除
            </button>
            <button
              onClick={() => setSelectedSources(new Set())}
              className={buttonStyles.secondarySmall}
            >
              取消选择
            </button>
          </div>
        )}

        {sources.length === 0 ? (
          <div className='text-center py-8 text-gray-500 dark:text-gray-400'>
            暂无Emby源，点击"添加新源"开始配置
          </div>
        ) : (
          sources.map((source) => (
            <div
              key={source.key}
              className='border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800'
            >
              <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3'>
                <div className='flex items-center gap-3 flex-1'>
                  <input
                    type='checkbox'
                    checked={selectedSources.has(source.key)}
                    onChange={(e) => {
                      const newSelected = new Set(selectedSources);
                      if (e.target.checked) {
                        newSelected.add(source.key);
                      } else {
                        newSelected.delete(source.key);
                      }
                      setSelectedSources(newSelected);
                    }}
                    className='w-4 h-4 text-blue-600 rounded-sm border-gray-300 dark:border-gray-600'
                  />
                  <div className='flex-1'>
                    <div className='flex items-center gap-3 flex-wrap'>
                      <h4 className='text-base font-medium text-gray-900 dark:text-gray-100'>
                        {source.name}
                      </h4>
                      {source.isDefault && (
                        <span className='px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 rounded-sm'>
                          默认
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded ${
                          source.enabled
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {source.enabled ? '已启用' : '已禁用'}
                      </span>
                    </div>
                    <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
                      标识符: {source.key}
                    </p>
                    <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
                      服务器: {source.ServerURL}
                    </p>
                    {source.UserId && (
                      <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
                        用户ID: {source.UserId}
                      </p>
                    )}
                  </div>
                </div>
                <div className='flex gap-2 flex-wrap sm:flex-nowrap'>
                  <button
                    onClick={() => handleToggleEnabled(source)}
                    disabled={isLoading('toggleEmbySource')}
                    className={
                      source.enabled
                        ? buttonStyles.warningSmall
                        : buttonStyles.successSmall
                    }
                  >
                    {source.enabled ? '禁用' : '启用'}
                  </button>
                  <button
                    onClick={() => handleTest(source)}
                    disabled={isLoading('testEmbySource')}
                    className={buttonStyles.primarySmall}
                  >
                    测试
                  </button>
                  <button
                    onClick={() => handleEdit(source)}
                    className={buttonStyles.primarySmall}
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(source)}
                    disabled={isLoading('deleteEmbySource')}
                    className={buttonStyles.dangerSmall}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 添加/编辑表单 */}
      {(showAddForm || editingSource) && (
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-gray-50 dark:bg-gray-800/50'>
          <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100 mb-4'>
            {editingSource ? '编辑 Emby 源' : '添加新的 Emby 源'}
          </h3>

          <div className='space-y-4'>
            {/* 标识符 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                标识符 *
              </label>
              <input
                type='text'
                value={formData.key}
                onChange={(e) =>
                  setFormData({ ...formData, key: e.target.value })
                }
                disabled={!!editingSource}
                placeholder='home, office, etc.'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:bg-gray-100 dark:disabled:bg-gray-700'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                唯一标识符，只能包含字母、数字、下划线，创建后不可修改
              </p>
            </div>

            {/* 名称 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                显示名称 *
              </label>
              <input
                type='text'
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder='家庭Emby, 公司Emby, etc.'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>

            {/* 服务器地址 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                Emby 服务器地址 *
              </label>
              <input
                type='text'
                value={formData.ServerURL}
                onChange={(e) =>
                  setFormData({ ...formData, ServerURL: e.target.value })
                }
                placeholder='http://192.168.1.100:8096'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>

            {/* 认证方式切换卡 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                认证方式 *
              </label>
              <div className='flex gap-2 mb-4'>
                <button
                  type='button'
                  onClick={() => {
                    setAuthMode('apikey');
                    // 切换到密钥认证时，清空用户名密码
                    setFormData({ ...formData, Username: '', Password: '' });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    authMode === 'apikey'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  密钥认证
                </button>
                <button
                  type='button'
                  onClick={() => {
                    setAuthMode('password');
                    // 切换到账号认证时，清空 API Key 和 UserId
                    setFormData({ ...formData, ApiKey: '', UserId: '' });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    authMode === 'password'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  账号认证
                </button>
              </div>
            </div>

            {/* 密钥认证模式 */}
            {authMode === 'apikey' && (
              <>
                {/* API Key */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    API Key *
                  </label>
                  <input
                    type='password'
                    value={formData.ApiKey}
                    onChange={(e) =>
                      setFormData({ ...formData, ApiKey: e.target.value })
                    }
                    placeholder='输入 Emby API Key'
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  />
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    在 Emby 控制台的 API 密钥页面生成
                  </p>
                </div>

                {/* 用户 ID */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    用户 ID *
                  </label>
                  <input
                    type='text'
                    value={formData.UserId}
                    onChange={(e) =>
                      setFormData({ ...formData, UserId: e.target.value })
                    }
                    placeholder='aab507c58e874de6a9bd12388d72f4d2'
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  />
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    从你的 Emby 抓包数据中获取用户 ID，通常在 URL 中如
                    /Users/[userId]/...
                  </p>
                </div>
              </>
            )}

            {/* 账号认证模式 */}
            {authMode === 'password' && (
              <>
                {/* 用户名 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    用户名 *
                  </label>
                  <input
                    type='text'
                    value={formData.Username}
                    onChange={(e) =>
                      setFormData({ ...formData, Username: e.target.value })
                    }
                    placeholder='Emby 用户名'
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  />
                </div>

                {/* 密码 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    密码（可选）
                  </label>
                  <input
                    type='password'
                    value={formData.Password}
                    onChange={(e) =>
                      setFormData({ ...formData, Password: e.target.value })
                    }
                    placeholder='Emby 密码（如果账号没有密码可留空）'
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  />
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    如果 Emby 账号没有设置密码，可以留空
                  </p>
                </div>
              </>
            )}

            {/* 启用开关 */}
            <div className='flex items-center justify-between'>
              <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                启用此源
              </label>
              <button
                onClick={() =>
                  setFormData({ ...formData, enabled: !formData.enabled })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formData.enabled
                    ? 'bg-blue-600'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formData.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 高级选项 */}
            <div className='border-t border-gray-200 dark:border-gray-700 pt-4 mt-4'>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
                高级选项
              </h4>

              {/* 选项1: 播放链接移除/emby前缀 */}
              <div className='flex items-center justify-between mb-3'>
                <div className='flex-1'>
                  <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    播放链接移除/emby前缀
                  </label>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    启用后将从播放链接中移除 /emby 前缀
                  </p>
                </div>
                <button
                  onClick={() =>
                    setFormData({
                      ...formData,
                      removeEmbyPrefix: !formData.removeEmbyPrefix,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.removeEmbyPrefix
                      ? 'bg-blue-600'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.removeEmbyPrefix
                        ? 'translate-x-6'
                        : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 选项2: 拼接MediaSourceId参数 */}
              <div className='flex items-center justify-between mb-3'>
                <div className='flex-1'>
                  <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    拼接MediaSourceId参数
                  </label>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    启用后将调用 PlaybackInfo API 获取 MediaSourceId
                    并添加到播放链接
                  </p>
                </div>
                <button
                  onClick={() =>
                    setFormData({
                      ...formData,
                      appendMediaSourceId: !formData.appendMediaSourceId,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.appendMediaSourceId
                      ? 'bg-blue-600'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.appendMediaSourceId
                        ? 'translate-x-6'
                        : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 选项3: 转码mp4 */}
              <div className='flex items-center justify-between mb-3'>
                <div className='flex-1'>
                  <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    转码mp4
                  </label>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    启用后将使用 stream.mp4 格式并移除 Static 参数
                  </p>
                </div>
                <button
                  onClick={() =>
                    setFormData({
                      ...formData,
                      transcodeMp4: !formData.transcodeMp4,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.transcodeMp4
                      ? 'bg-blue-600'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.transcodeMp4 ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 视频播放代理开关 */}
              <div className='flex items-center justify-between mb-3'>
                <div className='flex-1'>
                  <h4 className='text-sm font-medium text-gray-900 dark:text-white'>
                    视频播放代理
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    启用后视频播放将通过服务器代理
                  </p>
                </div>
                <button
                  onClick={() =>
                    setFormData({ ...formData, proxyPlay: !formData.proxyPlay })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.proxyPlay
                      ? 'bg-blue-600'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.proxyPlay ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 自定义User-Agent */}
              <div className='mb-3'>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  自定义User-Agent
                </label>
                <input
                  type='text'
                  value={formData.customUserAgent || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      customUserAgent: e.target.value,
                    })
                  }
                  placeholder='留空使用默认浏览器UA'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-xs focus:outline-hidden focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm'
                />
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  用于登录、获取影片和代理视频时的User-Agent，留空则使用默认浏览器UA
                </p>
              </div>

              {/* 自定义 X-Emby-Authorization */}
              <div className='mb-3'>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  自定义 X-Emby-Authorization
                </label>
                <input
                  type='text'
                  value={formData.embyAuthorizationHeader || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      embyAuthorizationHeader: e.target.value,
                    })
                  }
                  placeholder='留空使用默认 PureTV 认证头'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-xs focus:outline-hidden focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm'
                />
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  仅用于账号认证登录请求，示例：MediaBrowser
                  Client=&quot;PureTV&quot;, Device=&quot;Web&quot;,
                  DeviceId=&quot;puretv-web&quot;, Version=&quot;{CURRENT_VERSION}&quot;
                </p>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className='flex gap-3 pt-4'>
              <button
                onClick={handleSave}
                disabled={isLoading('saveEmbySource')}
                className={buttonStyles.success}
              >
                {isLoading('saveEmbySource') ? '保存中...' : '保存'}
              </button>
              <button onClick={resetForm} className={buttonStyles.secondary}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全局操作 */}
      <div className='flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
        <button
          onClick={handleClearCache}
          disabled={isLoading('clearEmbyCache')}
          className={buttonStyles.warning}
        >
          {isLoading('clearEmbyCache') ? '清除中...' : '清除所有缓存'}
        </button>
        <button
          onClick={handleExport}
          disabled={isLoading('exportEmby')}
          className={buttonStyles.secondary}
        >
          {isLoading('exportEmby') ? '导出中...' : '导出配置'}
        </button>
        <button
          onClick={handleImport}
          disabled={isLoading('importEmby')}
          className={buttonStyles.secondary}
        >
          {isLoading('importEmby') ? '导入中...' : '导入配置'}
        </button>
      </div>
    </div>
  );
};
