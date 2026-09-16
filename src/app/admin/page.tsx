/* eslint-disable @typescript-eslint/no-explicit-any, no-console,react-hooks/exhaustive-deps */

'use client';

import { AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig, AdminConfigResult } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';
import { hasUnsavedChanges } from '@/hooks/useUnsavedChanges';

import { AdminOverview } from '@/components/admin/AdminOverview';
import { AdminPanel } from '@/components/admin/AdminPanel';
import { AdminWorkspace } from '@/components/admin/AdminWorkspace';
import {
  AdminSectionId,
  visibleAdminSections,
} from '@/components/admin/navigation';
import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';
import { UnsavedChangesDialog } from '@/components/admin/UnsavedChangesDialog';
const AIConfigComponent = dynamic(
  () =>
    import('@/components/admin/AIConfigComponent').then(
      (module) => module.AIConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);
const ConfigFileComponent = dynamic(
  () =>
    import('@/components/admin/ConfigFileComponent').then(
      (module) => module.ConfigFileComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);
const EmailConfigComponent = dynamic(
  () =>
    import('@/components/admin/EmailConfigComponent').then(
      (module) => module.EmailConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);
const TelegramConfigComponent = dynamic(
  () =>
    import('@/components/admin/TelegramConfigComponent').then(
      (module) => module.TelegramConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);
const XiaoyaConfigComponent = dynamic(
  () =>
    import('@/components/admin/XiaoyaConfigComponent').then(
      (module) => module.XiaoyaConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);
const AnimeSubscriptionComponent = dynamic(
  () => import('@/components/AnimeSubscriptionComponent'),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);
const DataMigration = dynamic(() => import('@/components/DataMigration'), {
  loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p>,
});

const UserConfig = dynamic(
  () =>
    import('@/components/admin/UserConfig').then((module) => module.UserConfig),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const OpenListConfigComponent = dynamic(
  () =>
    import('@/components/admin/OpenListConfigComponent').then(
      (module) => module.OpenListConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const NetDiskConfigComponent = dynamic(
  () =>
    import('@/components/admin/NetDiskConfigComponent').then(
      (module) => module.NetDiskConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const EmbyConfigComponent = dynamic(
  () =>
    import('@/components/admin/EmbyConfigComponent').then(
      (module) => module.EmbyConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const VideoSourceConfig = dynamic(
  () =>
    import('@/components/admin/VideoSourceConfig').then(
      (module) => module.VideoSourceConfig
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const CategoryConfig = dynamic(
  () =>
    import('@/components/admin/CategoryConfig').then(
      (module) => module.CategoryConfig
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const VideoSourceScriptLab = dynamic(
  () =>
    import('@/components/admin/VideoSourceScriptLab').then(
      (module) => module.VideoSourceScriptLab
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const ThemeConfigComponent = dynamic(
  () =>
    import('@/components/admin/ThemeConfigComponent').then(
      (module) => module.ThemeConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const SiteConfigComponent = dynamic(
  () =>
    import('@/components/admin/SiteConfigComponent').then(
      (module) => module.SiteConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const RegistrationConfigComponent = dynamic(
  () =>
    import('@/components/admin/RegistrationConfigComponent').then(
      (module) => module.RegistrationConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const CustomAdFilterConfig = dynamic(
  () =>
    import('@/components/admin/CustomAdFilterConfig').then(
      (module) => module.CustomAdFilterConfig
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const SuwayomiConfigComponent = dynamic(
  () =>
    import('@/components/admin/SuwayomiConfigComponent').then(
      (module) => module.SuwayomiConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const OPDSConfigComponent = dynamic(
  () =>
    import('@/components/admin/OPDSConfigComponent').then(
      (module) => module.OPDSConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const MovieRequestsComponent = dynamic(
  () =>
    import('@/components/admin/MovieRequestsComponent').then(
      (module) => module.MovieRequestsComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const MusicConfigComponent = dynamic(
  () =>
    import('@/components/admin/MusicConfigComponent').then(
      (module) => module.MusicConfigComponent
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const LiveSourceConfig = dynamic(
  () =>
    import('@/components/admin/LiveSourceConfig').then(
      (module) => module.LiveSourceConfig
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

const WebLiveConfig = dynamic(
  () =>
    import('@/components/admin/WebLiveConfig').then(
      (module) => module.WebLiveConfig
    ),
  { loading: () => <p className='p-4 text-gray-500'>加载配置面板…</p> }
);

function AdminPageClient() {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [showResetConfigModal, setShowResetConfigModal] = useState(false);
  const [activeSection, setActiveSection] =
    useState<AdminSectionId>('overview');
  const activeSectionRef = useRef<AdminSectionId>('overview');
  const [pendingSection, setPendingSection] = useState<AdminSectionId | null>(
    null
  );

  // 获取管理员配置
  // showLoading 用于控制是否在请求期间显示整体加载骨架。
  const fetchConfig = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setError(null);
        setLoading(true);
      }

      const response = await fetch(`/api/admin/config`);

      if (!response.ok) {
        const data = (await response.json()) as any;
        throw new Error(`获取配置失败: ${data.error}`);
      }

      const data = (await response.json()) as AdminConfigResult;
      setConfig(data.Config);
      setRole(data.Role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取配置失败';
      // 只在首次加载时设置错误状态，避免弹窗和错误页面同时显示
      if (showLoading) {
        setError(msg);
      } else {
        showError(msg, showAlert);
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // 新版本用户列表状态
  const [usersV2, setUsersV2] = useState<Array<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    banned: boolean;
    tags?: string[];
    enabledApis?: string[];
    created_at: number;
  }> | null>(null);

  // 用户列表分页状态
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userListLoading, setUserListLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const userLimit = 10;

  // 获取新版本用户列表
  const fetchUsersV2 = useCallback(
    async (page = 1, search = userSearch) => {
      try {
        setUserListLoading(true);
        const params = new URLSearchParams({
          page: String(page),
          limit: String(userLimit),
        });
        const trimmedSearch = search.trim();
        if (trimmedSearch) {
          params.set('search', trimmedSearch);
        }
        const response = await fetch(`/api/admin/users?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setUsersV2(data.users);
          setUserTotalPages(data.totalPages || 1);
          setUserTotal(data.total || 0);
          setUserPage(page);
        }
      } catch (err) {
        console.error('获取新版本用户列表失败:', err);
      } finally {
        setUserListLoading(false);
      }
    },
    [userSearch]
  );

  // 刷新配置和用户列表
  const refreshConfigAndUsers = useCallback(async () => {
    await fetchConfig();
    await fetchUsersV2(userPage); // 保持当前页码
  }, [fetchConfig, fetchUsersV2, userPage]);

  useEffect(() => {
    // 首次加载时显示骨架
    void fetchConfig(true);
    // 不再自动获取用户列表，等用户打开用户管理选项卡时再获取
  }, [fetchConfig]);

  useEffect(() => {
    const readSection = () => {
      const id = window.location.hash.slice(1);
      if (id === 'admin-content') return;
      const next =
        visibleAdminSections(role).find((item) => item.id === id)?.id ||
        'overview';
      const current = activeSectionRef.current;
      if (current !== next && hasUnsavedChanges()) {
        setPendingSection(next);
        window.history.replaceState(window.history.state, '', '#' + current);
        return;
      }
      activeSectionRef.current = next;
      setActiveSection(next);
    };
    readSection();
    window.addEventListener('popstate', readSection);
    window.addEventListener('hashchange', readSection);
    return () => {
      window.removeEventListener('popstate', readSection);
      window.removeEventListener('hashchange', readSection);
    };
  }, [role]);

  useEffect(() => {
    if (activeSection !== 'userConfig' || usersV2) return;
    void fetchUsersV2();
  }, [activeSection, usersV2, fetchUsersV2]);

  const navigate = (id: AdminSectionId, discard = false) => {
    if (id === activeSection) return true;
    if (!discard && hasUnsavedChanges()) {
      setPendingSection(id);
      return false;
    }
    activeSectionRef.current = id;
    setActiveSection(id);
    window.history.pushState(window.history.state, '', '#' + id);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    return true;
  };

  // 重置配置只从系统维护栏目进入。
  // 新增: 重置配置处理函数
  const handleResetConfig = () => {
    setShowResetConfigModal(true);
  };

  const handleConfirmResetConfig = async () => {
    await withLoading('resetConfig', async () => {
      try {
        const response = await fetch(`/api/admin/reset`);
        if (!response.ok) {
          throw new Error(`重置失败: ${response.status}`);
        }
        showSuccess('重置成功，请刷新页面！', showAlert);
        await fetchConfig();
        setShowResetConfigModal(false);
      } catch (err) {
        showError(err instanceof Error ? err.message : '重置失败', showAlert);
        throw err;
      }
    });
  };

  // 新增: 重载配置处理函数
  const handleReloadConfig = async () => {
    await withLoading('reloadConfig', async () => {
      try {
        const response = await fetch(`/api/admin/reload`);
        if (!response.ok) {
          throw new Error(`重载失败: ${response.status}`);
        }
        showSuccess('重载成功，配置缓存已清除！', showAlert);
        await fetchConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '重载失败', showAlert);
        throw err;
      }
    });
  };

  const renderPanel = () => {
    switch (activeSection) {
      case 'configFile':
        return (
          <ConfigFileComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'siteConfig':
        return (
          <SiteConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'registrationConfig':
        return (
          <RegistrationConfigComponent
            config={config}
            refreshConfig={fetchConfig}
          />
        );
      case 'themeConfig':
        return (
          <ThemeConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'userConfig':
        return (
          <UserConfig
            config={config}
            role={role}
            refreshConfig={refreshConfigAndUsers}
            usersV2={usersV2}
            userPage={userPage}
            userTotalPages={userTotalPages}
            userTotal={userTotal}
            fetchUsersV2={fetchUsersV2}
            userListLoading={userListLoading}
            userSearch={userSearch}
            setUserSearch={setUserSearch}
          />
        );
      case 'videoSource':
        return (
          <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
        );
      case 'sourceScriptLab':
        return <VideoSourceScriptLab />;
      case 'musicConfig':
        return (
          <MusicConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'suwayomiConfig':
        return (
          <SuwayomiConfigComponent
            config={config}
            refreshConfig={fetchConfig}
          />
        );
      case 'opdsConfig':
        return (
          <OPDSConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'liveSource':
        return <LiveSourceConfig config={config} refreshConfig={fetchConfig} />;
      case 'webLive':
        return <WebLiveConfig config={config} refreshConfig={fetchConfig} />;
      case 'openListConfig':
        return (
          <OpenListConfigComponent
            config={config}
            refreshConfig={fetchConfig}
          />
        );
      case 'embyConfig':
        return (
          <EmbyConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'xiaoyaConfig':
        return (
          <XiaoyaConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'movieRequests':
        return (
          <MovieRequestsComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'animeSubscription':
        return (
          <AnimeSubscriptionComponent
            config={config}
            refreshConfig={fetchConfig}
          />
        );
      case 'netDiskConfig':
        return (
          <NetDiskConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'aiConfig':
        return (
          <AIConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'emailConfig':
        return (
          <EmailConfigComponent config={config} refreshConfig={fetchConfig} />
        );
      case 'telegramConfig':
        return (
          <TelegramConfigComponent
            config={config}
            refreshConfig={fetchConfig}
          />
        );
      case 'categoryConfig':
        return <CategoryConfig config={config} refreshConfig={fetchConfig} />;
      case 'customAdFilter':
        return (
          <CustomAdFilterConfig config={config} refreshConfig={fetchConfig} />
        );
      case 'dataMigration':
        return <DataMigration onRefreshConfig={refreshConfigAndUsers} />;
      case 'maintenance':
        return (
          <div className='space-y-6'>
            <section className='rounded-lg border border-slate-200 p-5 dark:border-slate-700'>
              <h2 className='font-semibold'>重载配置缓存</h2>
              <p className='mb-4 mt-2 text-sm leading-6 text-slate-500'>
                清除服务端配置缓存并重新读取已保存的配置。
              </p>
              <button
                disabled={isLoading('reloadConfig')}
                onClick={handleReloadConfig}
                className={buttonStyles.secondary}
              >
                {isLoading('reloadConfig') ? '重载中…' : '重载配置'}
              </button>
            </section>
            <section className='rounded-lg border border-red-200 p-5 dark:border-red-900'>
              <h2 className='font-semibold text-red-700 dark:text-red-400'>
                重置站点配置
              </h2>
              <p className='mb-4 mt-2 text-sm leading-6 text-slate-500'>
                重置用户封禁和管理员设置、自定义视频源以及站点设置。建议先在数据迁移中导出备份。
              </p>
              <button
                onClick={handleResetConfig}
                className={buttonStyles.danger}
              >
                重置配置
              </button>
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <AdminWorkspace
      active={activeSection}
      role={role}
      siteName={config?.SiteConfig.SiteName}
      onNavigate={navigate}
    >
      {loading ? (
        <div role='status' aria-label='正在加载管理配置' className='space-y-4'>
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className='h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800'
            />
          ))}
        </div>
      ) : error ? (
        <div
          role='alert'
          className='rounded-xl border border-red-200 bg-white p-8 dark:border-red-900 dark:bg-slate-900'
        >
          <AlertCircle className='mb-4 text-red-500' size={28} />
          <h2 className='mb-2 text-lg font-semibold'>暂时无法打开管理面板</h2>
          <p className='mb-6 text-sm text-slate-500'>{error}</p>
          <div className='flex flex-wrap gap-3'>
            <button
              onClick={() => void fetchConfig(true)}
              className={buttonStyles.primary}
            >
              重新加载
            </button>
            <a href='/login' className={buttonStyles.secondary}>
              重新登录
            </a>
          </div>
        </div>
      ) : (
        config &&
        (activeSection === 'overview' ? (
          <AdminOverview config={config} role={role} onNavigate={navigate} />
        ) : (
          <AdminPanel key={activeSection} version={config.ConfigVersion || 0}>
            {renderPanel()}
          </AdminPanel>
        ))
      )}
      <UnsavedChangesDialog
        open={pendingSection !== null}
        onCancel={() => setPendingSection(null)}
        onDiscard={() => {
          if (pendingSection) navigate(pendingSection, true);
          setPendingSection(null);
        }}
      />
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

      {/* 重置配置确认弹窗 */}
      {showResetConfigModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => setShowResetConfigModal(false)}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认重置配置
                  </h3>
                  <button
                    onClick={() => setShowResetConfigModal(false)}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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
                </div>

                <div className='mb-6'>
                  <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                        ⚠️ 危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-yellow-700 dark:text-yellow-400'>
                      此操作将重置用户封禁和管理员设置、自定义视频源，站点配置将重置为默认值，是否继续？
                    </p>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => setShowResetConfigModal(false)}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmResetConfig}
                    disabled={isLoading('resetConfig')}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading('resetConfig')
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }`}
                  >
                    {isLoading('resetConfig') ? '重置中...' : '确认重置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </AdminWorkspace>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}
