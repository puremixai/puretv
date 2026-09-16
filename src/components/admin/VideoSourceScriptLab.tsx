/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import { useEffect, useRef, useState } from 'react';

import { adminFetch as fetch } from '@/lib/admin-fetch';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

import { StandaloneSourceScript } from './types';

export const VideoSourceScriptLab = () => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [scripts, setScripts] = useState<StandaloneSourceScript[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(true);
  const [template, setTemplate] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    id?: string;
    key: string;
    name: string;
    description: string;
    code: string;
    enabled: boolean;
    version?: string;
    updatedAt?: number;
  }>({
    key: '',
    name: '',
    description: '',
    code: '',
    enabled: true,
  });
  const [testHook, setTestHook] = useState<
    'getSources' | 'search' | 'recommend' | 'detail' | 'resolvePlayUrl'
  >('getSources');
  const [testPayload, setTestPayload] = useState(JSON.stringify({}, null, 2));
  const [testOutput, setTestOutput] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const applyEditorFromScript = (script: StandaloneSourceScript | null) => {
    if (!script) {
      setEditor({
        key: '',
        name: '',
        description: '',
        code: template,
        enabled: true,
      });
      setSelectedScriptId(null);
      return;
    }

    setEditor({
      id: script.id,
      key: script.key,
      name: script.name,
      description: script.description || '',
      code: script.code,
      enabled: script.enabled,
      version: script.version,
      updatedAt: script.updatedAt,
    });
    setSelectedScriptId(script.id);
  };

  const loadScripts = async (preferId?: string | null) => {
    setLoadingScripts(true);
    try {
      const response = await fetch('/api/admin/source-script', {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '加载脚本失败');
      }

      const nextScripts = (data.items || []) as StandaloneSourceScript[];
      setScripts(nextScripts);
      setTemplate(data.template || '');

      const targetId =
        preferId !== undefined
          ? preferId
          : selectedScriptId || nextScripts[0]?.id || null;

      const selected = nextScripts.find((item) => item.id === targetId) || null;
      if (selected) {
        applyEditorFromScript(selected);
      } else {
        setEditor({
          key: '',
          name: '',
          description: '',
          code: data.template || '',
          enabled: true,
        });
        setSelectedScriptId(null);
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : '加载脚本失败',
        showAlert
      );
    } finally {
      setLoadingScripts(false);
    }
  };

  useEffect(() => {
    loadScripts();
  }, []);

  const handleCreateNew = () => {
    setSelectedScriptId(null);
    setEditor({
      key: '',
      name: '',
      description: '',
      code: template,
      enabled: true,
    });
    setTestOutput('');
  };

  const handleExportCurrent = () => {
    if (!editor.key || !editor.name || !editor.code) {
      showError('当前没有可导出的脚本', showAlert);
      return;
    }

    const payload = {
      key: editor.key,
      name: editor.name,
      description: editor.description,
      code: editor.code,
      enabled: editor.enabled,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${editor.key}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      await withLoading('importSourceScript', async () => {
        const response = await fetch('/api/admin/source-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'import',
            items,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || '导入失败');
        }

        showSuccess(`已导入 ${data.items?.length || 0} 个脚本`, showAlert);
        await loadScripts(data.items?.[0]?.id || null);
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : '导入失败', showAlert);
    } finally {
      event.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!editor.key || !editor.name || !editor.code) {
      showError('请填写脚本 Key、名称和代码', showAlert);
      return;
    }

    await withLoading('saveSourceScript', async () => {
      const response = await fetch('/api/admin/source-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          id: editor.id,
          key: editor.key,
          name: editor.name,
          description: editor.description,
          code: editor.code,
          enabled: editor.enabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '保存失败');
      }

      showSuccess('脚本已保存', showAlert);
      await loadScripts(data.item?.id || editor.id || null);
    }).catch((error) => {
      showError(error instanceof Error ? error.message : '保存失败', showAlert);
    });
  };

  const handleDelete = async () => {
    if (!editor.id) {
      handleCreateNew();
      return;
    }

    showAlert({
      type: 'warning',
      title: '删除脚本',
      message: `确定要删除脚本 "${editor.name}" 吗？`,
      showConfirm: true,
      onConfirm: async () => {
        hideAlert();
        await withLoading('deleteSourceScript', async () => {
          const response = await fetch('/api/admin/source-script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'delete',
              id: editor.id,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.error || '删除失败');
          }
          showSuccess('脚本已删除', showAlert);
          await loadScripts(null);
        }).catch((error) => {
          showError(
            error instanceof Error ? error.message : '删除失败',
            showAlert
          );
        });
      },
    });
  };

  const handleToggleEnabled = async (id: string) => {
    await withLoading(`toggleSourceScript_${id}`, async () => {
      const response = await fetch('/api/admin/source-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_enabled',
          id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '更新失败');
      }
      await loadScripts(id);
    }).catch((error) => {
      showError(error instanceof Error ? error.message : '更新失败', showAlert);
    });
  };

  const handleTest = async () => {
    let payload = {};
    try {
      payload = testPayload.trim() ? JSON.parse(testPayload) : {};
    } catch {
      showError('测试输入必须是合法 JSON', showAlert);
      return;
    }

    await withLoading('testSourceScript', async () => {
      const response = await fetch('/api/admin/source-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          key: editor.key || 'test-script',
          name: editor.name || '测试脚本',
          code: editor.code,
          hook: testHook,
          payload,
        }),
      });
      const data = await response.json().catch(() => ({}));
      setTestOutput(JSON.stringify(data, null, 2));
      if (!response.ok) {
        throw new Error(data.error || data.message || '测试失败');
      }
      showSuccess('测试执行完成', showAlert);
    }).catch((error) => {
      showError(error instanceof Error ? error.message : '测试失败', showAlert);
    });
  };

  useEffect(() => {
    setTestPayload(
      testHook === 'getSources'
        ? JSON.stringify({}, null, 2)
        : testHook === 'search'
        ? JSON.stringify(
            { keyword: '凡人修仙传', page: 1, sourceId: 'main' },
            null,
            2
          )
        : testHook === 'recommend'
        ? JSON.stringify({ page: 1 }, null, 2)
        : testHook === 'detail'
        ? JSON.stringify({ id: 'demo-id', sourceId: 'main' }, null, 2)
        : JSON.stringify(
            {
              sourceId: 'main',
              playUrl: 'https://example.com/video.m3u8',
              episodeIndex: 0,
            },
            null,
            2
          )
    );
  }, [testHook]);

  return (
    <div className='space-y-6'>
      <div className='flex flex-col lg:flex-row gap-6'>
        <div className='lg:w-80 space-y-4'>
          <div className='flex items-center justify-between'>
            <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              脚本列表
            </h4>
            <div className='flex items-center gap-2'>
              <input
                ref={importInputRef}
                type='file'
                accept='application/json,.json'
                onChange={handleImportFile}
                className='hidden'
              />
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={isLoading('importSourceScript')}
                className={
                  isLoading('importSourceScript')
                    ? buttonStyles.disabledSmall
                    : buttonStyles.primarySmall
                }
              >
                导入
              </button>
              <button
                onClick={() => loadScripts(selectedScriptId)}
                disabled={loadingScripts}
                className={
                  loadingScripts
                    ? buttonStyles.disabledSmall
                    : buttonStyles.secondarySmall
                }
              >
                刷新
              </button>
              <button
                onClick={handleCreateNew}
                className={buttonStyles.successSmall}
              >
                新建
              </button>
            </div>
          </div>

          <div className='space-y-3 max-h-152 overflow-y-auto pr-1'>
            {loadingScripts ? (
              <div className='text-sm text-gray-500 dark:text-gray-400'>
                加载中...
              </div>
            ) : scripts.length === 0 ? (
              <div className='p-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400'>
                还没有脚本，点右上角新建一个。
              </div>
            ) : (
              scripts.map((script) => (
                <button
                  key={script.id}
                  onClick={() => {
                    applyEditorFromScript(script);
                    setTestOutput('');
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selectedScriptId === script.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                  }`}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <div className='min-w-0'>
                      <div className='font-medium text-gray-900 dark:text-gray-100 truncate'>
                        {script.name}
                      </div>
                      <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                        {script.key}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        script.enabled
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      {script.enabled ? '启用' : '停用'}
                    </span>
                  </div>
                  <div className='mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                    <span>
                      {new Date(script.updatedAt).toLocaleString('zh-CN')}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleEnabled(script.id);
                      }}
                      disabled={isLoading(`toggleSourceScript_${script.id}`)}
                      className={
                        script.enabled
                          ? buttonStyles.warningSmall
                          : buttonStyles.successSmall
                      }
                    >
                      {script.enabled ? '停用' : '启用'}
                    </button>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className='flex-1 space-y-6'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='脚本名称'
              value={editor.name}
              onChange={(e) =>
                setEditor((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='脚本 Key'
              value={editor.key}
              onChange={(e) =>
                setEditor((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>

          <textarea
            placeholder='脚本描述（可选）'
            value={editor.description}
            onChange={(e) =>
              setEditor((prev) => ({ ...prev, description: e.target.value }))
            }
            rows={2}
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />

          <div>
            <div className='flex items-center justify-between mb-2'>
              <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                脚本代码
              </label>
              <div className='text-xs text-gray-500 dark:text-gray-400'>
                {editor.version ? `当前版本: ${editor.version}` : '未保存'}
              </div>
            </div>
            <textarea
              value={editor.code}
              onChange={(e) =>
                setEditor((prev) => ({ ...prev, code: e.target.value }))
              }
              rows={24}
              spellCheck={false}
              className='w-full px-3 py-3 font-mono text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-950 text-gray-100'
            />
          </div>

          <div className='flex flex-wrap items-center gap-3'>
            <button
              onClick={handleSave}
              disabled={isLoading('saveSourceScript')}
              className={
                isLoading('saveSourceScript')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }
            >
              {isLoading('saveSourceScript') ? '保存中...' : '保存脚本'}
            </button>
            <button
              onClick={handleTest}
              disabled={isLoading('testSourceScript')}
              className={
                isLoading('testSourceScript')
                  ? buttonStyles.disabled
                  : buttonStyles.primary
              }
            >
              {isLoading('testSourceScript') ? '测试中...' : '运行测试'}
            </button>
            <button
              onClick={handleExportCurrent}
              className={buttonStyles.secondary}
            >
              导出当前脚本
            </button>
            <button onClick={handleDelete} className={buttonStyles.danger}>
              {editor.id ? '删除脚本' : '清空编辑器'}
            </button>
          </div>

          <div className='grid grid-cols-1 xl:grid-cols-2 gap-6'>
            <div className='space-y-3'>
              <div className='flex items-center gap-3'>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  测试 Hook
                </label>
                <select
                  value={testHook}
                  onChange={(e) =>
                    setTestHook(
                      e.target.value as
                        | 'getSources'
                        | 'search'
                        | 'recommend'
                        | 'detail'
                        | 'resolvePlayUrl'
                    )
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                >
                  <option value='getSources'>getSources</option>
                  <option value='search'>search</option>
                  <option value='recommend'>recommend</option>
                  <option value='detail'>detail</option>
                  <option value='resolvePlayUrl'>resolvePlayUrl</option>
                </select>
              </div>
              <p className='text-xs text-gray-500 dark:text-gray-400'>
                现在脚本可以自己管理多个源，测试入参可传 `sourceId`。
              </p>
              <textarea
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                rows={10}
                spellCheck={false}
                className='w-full px-3 py-3 font-mono text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>

            <div className='space-y-3'>
              <div className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                测试输出
              </div>
              <pre className='w-full min-h-64 whitespace-pre-wrap break-all px-3 py-3 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-950 text-gray-100 overflow-auto'>
                {testOutput || '运行测试后会显示结果、日志和错误信息'}
              </pre>
            </div>
          </div>
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
        onConfirm={alertModal.onConfirm}
      />
    </div>
  );
};
