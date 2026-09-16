/* eslint-disable @typescript-eslint/no-explicit-any, no-console,react-hooks/exhaustive-deps */

'use client';

import {
  AlertTriangle,
  Monitor,
  Search,
  Smartphone,
  Tablet,
  X,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminFetch as fetch } from '@/lib/admin-fetch';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { FEATURE_PERMISSION_OPTIONS } from '@/lib/feature-permissions';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

import { DEFAULT_GROUP_PERMISSIONS, UserConfigProps } from './types';

export const UserConfig = ({
  config,
  role,
  refreshConfig,
  usersV2,
  userPage,
  userTotalPages,
  userTotal,
  fetchUsersV2,
  userListLoading,
  userSearch,
  setUserSearch,
}: UserConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [showAddUserGroupForm, setShowAddUserGroupForm] = useState(false);
  const [showEditUserGroupForm, setShowEditUserGroupForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    userGroup: '', // 新增用户组字段
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  const [newUserGroup, setNewUserGroup] = useState({
    name: '',
    enabledApis: [] as string[],
    permissions: [...DEFAULT_GROUP_PERMISSIONS] as string[],
  });
  const [editingUserGroup, setEditingUserGroup] = useState<{
    name: string;
    enabledApis: string[];
    permissions: string[];
  } | null>(null);
  const [showConfigureApisModal, setShowConfigureApisModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
    tags?: string[];
  } | null>(null);
  const [selectedApis, setSelectedApis] = useState<string[]>([]);
  const [showConfigureUserGroupModal, setShowConfigureUserGroupModal] =
    useState(false);
  const [selectedUserForGroup, setSelectedUserForGroup] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  } | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showBatchUserGroupModal, setShowBatchUserGroupModal] = useState(false);
  const [selectedUserGroup, setSelectedUserGroup] = useState<string>('');
  const [showDeleteUserGroupModal, setShowDeleteUserGroupModal] =
    useState(false);
  const [deletingUserGroup, setDeletingUserGroup] = useState<{
    name: string;
    affectedUsers: Array<{
      username: string;
      role: 'user' | 'admin' | 'owner';
    }>;
  } | null>(null);
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [showUserDevicesModal, setShowUserDevicesModal] = useState(false);
  const [selectedDeviceUsername, setSelectedDeviceUsername] = useState<
    string | null
  >(null);
  const [userDevices, setUserDevices] = useState<
    Array<{
      tokenId: string;
      deviceInfo: string;
      createdAt: number;
      lastUsed: number;
      expiresAt: number;
      isCurrent?: boolean;
    }>
  >([]);
  const [userDevicesLoading, setUserDevicesLoading] = useState(false);
  const [revokingUserDevice, setRevokingUserDevice] = useState<string | null>(
    null
  );
  const trimmedUserSearch = userSearch.trim();

  // 当前登录用户名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;

  // 查看用户设备弹窗打开时锁定背景滚动，避免滚动穿透
  useEffect(() => {
    if (!showUserDevicesModal) return;

    const scrollY = window.scrollY;
    const originalStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.position = originalStyle.position;
      document.body.style.top = originalStyle.top;
      document.body.style.width = originalStyle.width;
      document.body.style.overflow = originalStyle.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [showUserDevicesModal]);

  // 判断是否有旧版用户数据需要迁移
  const hasOldUserData =
    config?.UserConfig?.Users?.filter((u: any) => u.role !== 'owner').length ??
    0 > 0;

  // 使用新版本用户列表（如果可用且没有旧数据），否则使用配置中的用户列表
  const displayUsers: Array<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    banned?: boolean;
    enabledApis?: string[];
    tags?: string[];
    created_at?: number;
    oidcSub?: string;
  }> = !hasOldUserData && usersV2 ? usersV2 : config?.UserConfig?.Users || [];

  // 使用 useMemo 计算全选状态，避免每次渲染都重新计算
  const selectAllUsers = useMemo(() => {
    const selectableUserCount =
      displayUsers?.filter(
        (user) =>
          role === 'owner' ||
          (role === 'admin' &&
            (user.role === 'user' || user.username === currentUsername))
      ).length || 0;
    return selectedUsers.size === selectableUserCount && selectedUsers.size > 0;
  }, [selectedUsers.size, displayUsers, role, currentUsername]);

  // 获取用户组列表
  const userGroups = config?.UserConfig?.Tags || [];

  // 处理用户组相关操作
  const handleUserGroupAction = async (
    action: 'add' | 'edit' | 'delete',
    groupName: string,
    enabledApis?: string[],
    permissions?: string[]
  ) => {
    return withLoading(`userGroup_${action}_${groupName}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'userGroup',
            groupAction: action,
            groupName,
            enabledApis,
            permissions,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        await refreshConfig();

        if (action === 'add') {
          setNewUserGroup({
            name: '',
            enabledApis: [],
            permissions: [...DEFAULT_GROUP_PERMISSIONS],
          });
          setShowAddUserGroupForm(false);
        } else if (action === 'edit') {
          setEditingUserGroup(null);
          setShowEditUserGroupForm(false);
        }

        showSuccess(
          action === 'add'
            ? '用户组添加成功'
            : action === 'edit'
            ? '用户组更新成功'
            : '用户组删除成功',
          showAlert
        );
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleAddUserGroup = () => {
    if (!newUserGroup.name.trim()) return;
    handleUserGroupAction(
      'add',
      newUserGroup.name,
      newUserGroup.enabledApis,
      newUserGroup.permissions
    );
  };

  const handleEditUserGroup = () => {
    if (!editingUserGroup?.name.trim()) return;
    handleUserGroupAction(
      'edit',
      editingUserGroup.name,
      editingUserGroup.enabledApis,
      editingUserGroup.permissions
    );
  };

  const handleDeleteUserGroup = (groupName: string) => {
    // 计算会受影响的用户数量
    const affectedUsers =
      config?.UserConfig?.Users?.filter(
        (user) => user.tags && user.tags.includes(groupName)
      ) || [];

    setDeletingUserGroup({
      name: groupName,
      affectedUsers: affectedUsers.map((u) => ({
        username: u.username,
        role: u.role,
      })),
    });
    setShowDeleteUserGroupModal(true);
  };

  const handleConfirmDeleteUserGroup = async () => {
    if (!deletingUserGroup) return;

    try {
      await handleUserGroupAction('delete', deletingUserGroup.name);
      setShowDeleteUserGroupModal(false);
      setDeletingUserGroup(null);
    } catch {
      // 错误处理已在 handleUserGroupAction 中处理
    }
  };

  const handleStartEditUserGroup = (group: {
    name: string;
    enabledApis: string[];
    permissions?: string[];
  }) => {
    setEditingUserGroup({
      ...group,
      permissions: group.permissions || [],
    });
    setShowEditUserGroupForm(true);
    setShowAddUserGroupForm(false);
  };

  // 为用户分配用户组
  const handleAssignUserGroup = async (
    username: string,
    userGroups: string[]
  ) => {
    return withLoading(`assignUserGroup_${username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: username,
            action: 'updateUserGroups',
            userGroups,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        await refreshConfig();
        showSuccess('用户组分配成功', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleBanUser = async (uname: string) => {
    await withLoading(`banUser_${uname}`, () => handleUserAction('ban', uname));
  };

  const handleUnbanUser = async (uname: string) => {
    await withLoading(`unbanUser_${uname}`, () =>
      handleUserAction('unban', uname)
    );
  };

  const handleSetAdmin = async (uname: string) => {
    await withLoading(`setAdmin_${uname}`, () =>
      handleUserAction('setAdmin', uname)
    );
  };

  const handleRemoveAdmin = async (uname: string) => {
    await withLoading(`removeAdmin_${uname}`, () =>
      handleUserAction('cancelAdmin', uname)
    );
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await withLoading('addUser', async () => {
      await handleUserAction(
        'add',
        newUser.username,
        newUser.password,
        newUser.userGroup
      );
      setNewUser({ username: '', password: '', userGroup: '' });
      setShowAddUserForm(false);
    });
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await withLoading(
      `changePassword_${changePasswordUser.username}`,
      async () => {
        await handleUserAction(
          'changePassword',
          changePasswordUser.username,
          changePasswordUser.password
        );
        setChangePasswordUser({ username: '', password: '' });
        setShowChangePasswordForm(false);
      }
    );
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 关闭添加用户表单
  };

  const handleDeleteUser = (username: string) => {
    setDeletingUser(username);
    setShowDeleteUserModal(true);
  };

  const getDeviceIcon = (deviceInfo: string) => {
    const info = deviceInfo.toLowerCase();

    if (
      info.includes('mobile') ||
      info.includes('iphone') ||
      info.includes('android')
    ) {
      return Smartphone;
    }

    if (info.includes('tablet') || info.includes('ipad')) {
      return Tablet;
    }

    return Monitor;
  };

  const handleViewUserDevices = async (username: string) => {
    setSelectedDeviceUsername(username);
    setShowUserDevicesModal(true);
    setUserDevices([]);
    setUserDevicesLoading(true);

    try {
      const params = new URLSearchParams({ username });
      const res = await fetch(`/api/admin/user-devices?${params.toString()}`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `获取设备失败: ${res.status}`);
      }

      const data = await res.json();
      setUserDevices(Array.isArray(data.devices) ? data.devices : []);
    } catch (err) {
      showError(err instanceof Error ? err.message : '获取设备失败', showAlert);
      setShowUserDevicesModal(false);
      setSelectedDeviceUsername(null);
    } finally {
      setUserDevicesLoading(false);
    }
  };

  const handleRevokeUserDevice = async (tokenId: string) => {
    if (!selectedDeviceUsername) return;

    setRevokingUserDevice(tokenId);
    try {
      const res = await fetch('/api/admin/user-devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: selectedDeviceUsername,
          tokenId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `登出设备失败: ${res.status}`);
      }

      setUserDevices((prev) =>
        prev.filter((device) => device.tokenId !== tokenId)
      );
      showSuccess('设备已登出', showAlert);
    } catch (err) {
      showError(err instanceof Error ? err.message : '登出设备失败', showAlert);
    } finally {
      setRevokingUserDevice(null);
    }
  };

  const handleConfigureUserApis = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
  }) => {
    setSelectedUser(user);
    setSelectedApis(user.enabledApis || []);
    setShowConfigureApisModal(true);
  };

  const handleConfigureUserGroup = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  }) => {
    setSelectedUserForGroup(user);
    setSelectedUserGroups(user.tags || []);
    setShowConfigureUserGroupModal(true);
  };

  const handleSaveUserGroups = async () => {
    if (!selectedUserForGroup) return;

    await withLoading(
      `saveUserGroups_${selectedUserForGroup.username}`,
      async () => {
        try {
          await handleAssignUserGroup(
            selectedUserForGroup.username,
            selectedUserGroups
          );
          setShowConfigureUserGroupModal(false);
          setSelectedUserForGroup(null);
          setSelectedUserGroups([]);
        } catch {
          // 错误处理已在 handleAssignUserGroup 中处理
        }
      }
    );
  };

  // 处理用户选择
  const handleSelectUser = useCallback((username: string, checked: boolean) => {
    setSelectedUsers((prev) => {
      const newSelectedUsers = new Set(prev);
      if (checked) {
        newSelectedUsers.add(username);
      } else {
        newSelectedUsers.delete(username);
      }
      return newSelectedUsers;
    });
  }, []);

  const handleSelectAllUsers = useCallback(
    (checked: boolean) => {
      if (checked) {
        // 只选择自己有权限操作的用户
        const selectableUsernames =
          displayUsers
            ?.filter(
              (user) =>
                role === 'owner' ||
                (role === 'admin' &&
                  (user.role === 'user' || user.username === currentUsername))
            )
            .map((u) => u.username) || [];
        setSelectedUsers(new Set(selectableUsernames));
      } else {
        setSelectedUsers(new Set());
      }
    },
    [displayUsers, role, currentUsername]
  );

  // 批量设置用户组
  const handleBatchSetUserGroup = async (userGroup: string) => {
    if (selectedUsers.size === 0) return;

    await withLoading('batchSetUserGroup', async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batchUpdateUserGroups',
            usernames: Array.from(selectedUsers),
            userGroups: userGroup === '' ? [] : [userGroup],
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        const userCount = selectedUsers.size;
        setSelectedUsers(new Set());
        setShowBatchUserGroupModal(false);
        setSelectedUserGroup('');
        showSuccess(
          `已为 ${userCount} 个用户设置用户组: ${userGroup}`,
          showAlert
        );

        // 刷新配置
        await refreshConfig();
      } catch (err) {
        showError('批量设置用户组失败', showAlert);
        throw err;
      }
    });
  };

  // 提取URL域名的辅助函数
  const extractDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      // 如果URL格式不正确，返回原字符串
      return url;
    }
  };

  const handleSaveUserApis = async () => {
    if (!selectedUser) return;

    await withLoading(`saveUserApis_${selectedUser.username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: selectedUser.username,
            action: 'updateUserApis',
            enabledApis: selectedApis,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        // 成功后刷新配置
        await refreshConfig();
        setShowConfigureApisModal(false);
        setSelectedUser(null);
        setSelectedApis([]);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  // 通用请求函数
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser',
    targetUsername: string,
    targetPassword?: string,
    userGroup?: string
  ) => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          ...(userGroup ? { userGroup } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      // 成功后刷新配置和用户列表（refreshConfig 已经是 refreshConfigAndUsers）
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;

    await withLoading(`deleteUser_${deletingUser}`, async () => {
      try {
        await handleUserAction('deleteUser', deletingUser);
        setShowDeleteUserModal(false);
        setDeletingUser(null);
      } catch {
        // 错误处理已在 handleUserAction 中处理
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 用户统计 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          用户统计
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {!hasOldUserData && usersV2 ? userTotal : displayUsers.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            总用户数
          </div>
        </div>

        {/* 数据迁移提示 */}
        {config.UserConfig.Users &&
          config.UserConfig.Users.filter((u) => u.role !== 'owner').length >
            0 && (
            <div className='mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800'>
              <div className='flex items-start justify-between'>
                <div className='flex-1'>
                  <h5 className='text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1'>
                    检测到旧版用户数据
                  </h5>
                  <p className='text-xs text-yellow-600 dark:text-yellow-400'>
                    建议迁移到新的用户存储结构，以获得更好的性能和安全性。迁移后用户密码将使用SHA256加密。
                  </p>
                </div>
                <button
                  onClick={() => {
                    showAlert({
                      type: 'warning',
                      title: '确认迁移用户数据',
                      message:
                        '迁移过程中请勿关闭页面。迁移完成后，所有用户密码将使用SHA256加密存储。',
                      showConfirm: true,
                      onConfirm: async () => {
                        hideAlert();
                        await withLoading('migrateUsers', async () => {
                          try {
                            const response = await fetch(
                              '/api/admin/migrate-users',
                              {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                              }
                            );

                            if (!response.ok) {
                              const errorData = await response.json();
                              throw new Error(errorData.error || '迁移失败');
                            }

                            showAlert({
                              type: 'success',
                              title: '用户数据迁移成功',
                              message: '所有用户已迁移到新的存储结构',
                              timer: 2000,
                            });
                            await refreshConfig();
                          } catch (error: any) {
                            console.error('迁移用户数据失败:', error);
                            showAlert({
                              type: 'error',
                              title: '迁移失败',
                              message:
                                error.message || '迁移用户数据时发生错误',
                            });
                          }
                        });
                      },
                    });
                  }}
                  disabled={isLoading('migrateUsers')}
                  className={`ml-4 ${buttonStyles.warning} ${
                    isLoading('migrateUsers')
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                >
                  {isLoading('migrateUsers') ? '迁移中...' : '立即迁移'}
                </button>
              </div>
            </div>
          )}
      </div>

      {/* 用户组管理 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户组管理
          </h4>
          <button
            onClick={() => {
              setShowAddUserGroupForm(!showAddUserGroupForm);
              if (showEditUserGroupForm) {
                setShowEditUserGroupForm(false);
                setEditingUserGroup(null);
              }
            }}
            className={
              showAddUserGroupForm
                ? buttonStyles.secondary
                : buttonStyles.primary
            }
          >
            {showAddUserGroupForm ? '取消' : '添加用户组'}
          </button>
        </div>

        {/* 用户组列表 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-80 overflow-y-auto overflow-x-auto relative'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  用户组名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  可用视频源
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  功能权限
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
              {userGroups.map((group) => (
                <tr
                  key={group.name}
                  className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                >
                  <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {group.name}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center space-x-2'>
                      <span className='text-sm text-gray-900 dark:text-gray-100'>
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `${group.enabledApis.length} 个源`
                          : '无限制'}
                      </span>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <span className='text-sm text-gray-900 dark:text-gray-100'>
                      {group.permissions && group.permissions.length > 0
                        ? `${group.permissions.length} 项`
                        : '无'}
                    </span>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                    <button
                      onClick={() => handleStartEditUserGroup(group)}
                      disabled={isLoading(`userGroup_edit_${group.name}`)}
                      className={`${buttonStyles.roundedPrimary} ${
                        isLoading(`userGroup_edit_${group.name}`)
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDeleteUserGroup(group.name)}
                      className={buttonStyles.roundedDanger}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {userGroups.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className='px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400'
                  >
                    暂无用户组，请添加用户组来管理用户权限
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 用户列表 */}
      <div>
        <div className='mb-3 space-y-3'>
          <div className='flex items-center justify-between gap-3'>
            <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              用户列表
            </h4>
            <button
              onClick={() => {
                setShowAddUserForm(!showAddUserForm);
                if (showChangePasswordForm) {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }
              }}
              className={
                showAddUserForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddUserForm ? '取消' : '添加用户'}
            </button>
          </div>
          <div className='flex w-full flex-wrap items-center justify-end gap-2'>
            {!hasOldUserData && usersV2 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setSelectedUsers(new Set());
                  fetchUsersV2(1, trimmedUserSearch);
                }}
                className='ml-auto flex min-w-0 items-center gap-2'
              >
                <div className='relative w-44 sm:w-56'>
                  <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400' />
                  <input
                    type='text'
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder='按用户名搜索'
                    className='w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                  />
                </div>
                {trimmedUserSearch && (
                  <button
                    type='button'
                    onClick={() => {
                      setUserSearch('');
                      setSelectedUsers(new Set());
                      fetchUsersV2(1, '');
                    }}
                    disabled={userListLoading}
                    aria-label='清空搜索'
                    title='清空'
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      userListLoading
                        ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white'
                        : 'bg-gray-600 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 text-white'
                    }`}
                  >
                    <X className='h-4 w-4' />
                  </button>
                )}
                <button
                  type='submit'
                  disabled={userListLoading}
                  aria-label='搜索用户'
                  title='搜索'
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    userListLoading
                      ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white'
                      : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white'
                  }`}
                >
                  <Search className='h-4 w-4' />
                </button>
              </form>
            )}
            {/* 批量操作按钮 */}
            {selectedUsers.size > 0 && (
              <>
                <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:space-x-3'>
                  <span className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择 {selectedUsers.size} 个用户
                  </span>
                  <button
                    onClick={() => setShowBatchUserGroupModal(true)}
                    className={buttonStyles.primary}
                  >
                    批量设置用户组
                  </button>
                </div>
                <div className='hidden sm:block w-px h-6 bg-gray-300 dark:bg-gray-600'></div>
              </>
            )}
          </div>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <input
                  type='text'
                  placeholder='用户名'
                  value={newUser.username}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
                <input
                  type='password'
                  placeholder='密码'
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  用户组（可选）
                </label>
                <select
                  value={newUser.userGroup}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      userGroup: e.target.value,
                    }))
                  }
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                >
                  <option value=''>无用户组（无限制）</option>
                  {userGroups.map((group) => (
                    <option key={group.name} value={group.name}>
                      {group.name} (
                      {group.enabledApis && group.enabledApis.length > 0
                        ? `${group.enabledApis.length} 个源`
                        : '无限制'}
                      )
                    </option>
                  ))}
                </select>
              </div>
              <div className='flex justify-end'>
                <button
                  onClick={handleAddUser}
                  disabled={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                  }
                  className={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                      ? buttonStyles.disabled
                      : buttonStyles.success
                  }
                >
                  {isLoading('addUser') ? '添加中...' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 修改密码表单 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改用户密码
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密码'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                }
                className={`w-full sm:w-auto ${
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                    ? buttonStyles.disabled
                    : buttonStyles.primary
                }`}
              >
                {isLoading(`changePassword_${changePasswordUser.username}`)
                  ? '修改中...'
                  : '修改密码'}
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className={`w-full sm:w-auto ${buttonStyles.secondary}`}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 用户列表 */}
        <div className='relative'>
          {/* 迁移遮罩层 */}
          {config.UserConfig.Users &&
            config.UserConfig.Users.filter((u) => u.role !== 'owner').length >
              0 && (
              <div className='absolute inset-0 z-20 backdrop-blur-xs bg-white/30 dark:bg-gray-900/30 rounded-lg flex items-center justify-center'>
                <div className='bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl border border-yellow-200 dark:border-yellow-800 max-w-md'>
                  <div className='flex items-center gap-3 mb-4'>
                    <AlertTriangle className='w-6 h-6 text-yellow-600 dark:text-yellow-400' />
                    <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                      需要迁移数据
                    </h3>
                  </div>
                  <p className='text-sm text-gray-600 dark:text-gray-400 mb-4'>
                    检测到旧版用户数据，请先迁移到新的存储结构后再进行用户管理操作。
                  </p>
                  <p className='text-xs text-gray-500 dark:text-gray-500'>
                    请在上方的"用户统计"区域点击"立即迁移"按钮完成数据迁移。
                  </p>
                </div>
              </div>
            )}
          <div
            className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
            data-table='user-list'
          >
            <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
              <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
                <tr>
                  <th className='w-4' />
                  <th className='w-10 px-1 py-3 text-center'>
                    {(() => {
                      // 检查是否有权限操作任何用户
                      const hasAnyPermission = displayUsers?.some(
                        (user) =>
                          role === 'owner' ||
                          (role === 'admin' &&
                            (user.role === 'user' ||
                              user.username === currentUsername))
                      );

                      return hasAnyPermission ? (
                        <input
                          type='checkbox'
                          checked={selectAllUsers}
                          onChange={(e) =>
                            handleSelectAllUsers(e.target.checked)
                          }
                          className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                        />
                      ) : (
                        <div className='w-4 h-4' />
                      );
                    })()}
                  </th>
                  <th
                    scope='col'
                    className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  >
                    用户名
                  </th>
                  <th
                    scope='col'
                    className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  >
                    角色
                  </th>
                  <th
                    scope='col'
                    className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  >
                    状态
                  </th>
                  <th
                    scope='col'
                    className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  >
                    用户组
                  </th>
                  <th
                    scope='col'
                    className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  >
                    采集源权限
                  </th>
                  <th
                    scope='col'
                    className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  >
                    操作
                  </th>
                </tr>
              </thead>
              {/* 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他 */}
              {(() => {
                // 如果正在加载，显示加载状态
                if (userListLoading) {
                  return (
                    <tbody>
                      <tr>
                        <td
                          colSpan={8}
                          className='px-6 py-8 text-center text-gray-500 dark:text-gray-400'
                        >
                          加载中...
                        </td>
                      </tr>
                    </tbody>
                  );
                }

                const sortedUsers = [...displayUsers].sort((a, b) => {
                  type UserInfo = (typeof displayUsers)[number];
                  const priority = (u: UserInfo) => {
                    if (u.username === currentUsername) return 0;
                    if (u.role === 'owner') return 1;
                    if (u.role === 'admin') return 2;
                    return 3;
                  };
                  return priority(a) - priority(b);
                });
                if (sortedUsers.length === 0) {
                  return (
                    <tbody>
                      <tr>
                        <td
                          colSpan={8}
                          className='px-6 py-8 text-center text-gray-500 dark:text-gray-400'
                        >
                          {trimmedUserSearch
                            ? `未找到用户名包含“${trimmedUserSearch}”的用户`
                            : '暂无用户'}
                        </td>
                      </tr>
                    </tbody>
                  );
                }

                return (
                  <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                    {sortedUsers.map((user) => {
                      // 修改密码权限：站长可修改管理员和普通用户密码，管理员可修改普通用户和自己的密码，但任何人都不能修改站长密码
                      const canChangePassword =
                        user.role !== 'owner' && // 不能修改站长密码
                        (role === 'owner' || // 站长可以修改管理员和普通用户密码
                          (role === 'admin' &&
                            (user.role === 'user' ||
                              user.username === currentUsername))); // 管理员可以修改普通用户和自己的密码

                      // 删除用户权限：站长可删除除自己外的所有用户，管理员仅可删除普通用户
                      const canDeleteUser =
                        user.username !== currentUsername &&
                        (role === 'owner' || // 站长可以删除除自己外的所有用户
                          (role === 'admin' && user.role === 'user')); // 管理员仅可删除普通用户

                      // 其他操作权限：不能操作自己，站长可操作所有用户，管理员可操作普通用户
                      const canOperate =
                        user.username !== currentUsername &&
                        (role === 'owner' ||
                          (role === 'admin' && user.role === 'user'));

                      // 查看设备权限：站长可查看所有用户，管理员可查看普通用户和自己
                      const canViewDevices =
                        role === 'owner' ||
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername));
                      return (
                        <tr
                          key={user.username}
                          className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                        >
                          <td className='w-4' />
                          <td className='w-10 px-1 py-3 text-center'>
                            {role === 'owner' ||
                            (role === 'admin' &&
                              (user.role === 'user' ||
                                user.username === currentUsername)) ? (
                              <input
                                type='checkbox'
                                checked={selectedUsers.has(user.username)}
                                onChange={(e) =>
                                  handleSelectUser(
                                    user.username,
                                    e.target.checked
                                  )
                                }
                                className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                              />
                            ) : (
                              <div className='w-4 h-4' />
                            )}
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                            <div className='flex items-center gap-2'>
                              <span>{user.username}</span>
                              {user.oidcSub && (
                                <span className='px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'>
                                  OIDC
                                </span>
                              )}
                            </div>
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap'>
                            <span
                              className={`px-2 py-1 text-xs rounded-full ${
                                user.role === 'owner'
                                  ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                  : user.role === 'admin'
                                  ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              {user.role === 'owner'
                                ? '站长'
                                : user.role === 'admin'
                                ? '管理员'
                                : '普通用户'}
                            </span>
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap'>
                            <span
                              className={`px-2 py-1 text-xs rounded-full ${
                                !user.banned
                                  ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                  : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                              }`}
                            >
                              {!user.banned ? '正常' : '已封禁'}
                            </span>
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap'>
                            <div className='flex items-center space-x-2'>
                              <span className='text-sm text-gray-900 dark:text-gray-100'>
                                {user.tags && user.tags.length > 0
                                  ? user.tags.join(', ')
                                  : '无用户组'}
                              </span>
                              {/* 配置用户组按钮 */}
                              {(role === 'owner' ||
                                (role === 'admin' &&
                                  (user.role === 'user' ||
                                    user.username === currentUsername))) && (
                                <button
                                  onClick={() => handleConfigureUserGroup(user)}
                                  className={buttonStyles.roundedPrimary}
                                >
                                  配置
                                </button>
                              )}
                            </div>
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap'>
                            <div className='flex items-center space-x-2'>
                              <span className='text-sm text-gray-900 dark:text-gray-100'>
                                {user.enabledApis && user.enabledApis.length > 0
                                  ? `${user.enabledApis.length} 个源`
                                  : '无限制'}
                              </span>
                              {/* 配置采集源权限按钮 */}
                              {(role === 'owner' ||
                                (role === 'admin' &&
                                  (user.role === 'user' ||
                                    user.username === currentUsername))) && (
                                <button
                                  onClick={() => handleConfigureUserApis(user)}
                                  className={buttonStyles.roundedPrimary}
                                >
                                  配置
                                </button>
                              )}
                            </div>
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                            {/* 查看设备按钮 */}
                            {canViewDevices && (
                              <button
                                onClick={() =>
                                  handleViewUserDevices(user.username)
                                }
                                className={buttonStyles.roundedSecondary}
                              >
                                查看设备
                              </button>
                            )}
                            {/* 修改密码按钮 */}
                            {canChangePassword && (
                              <button
                                onClick={() =>
                                  handleShowChangePasswordForm(user.username)
                                }
                                className={buttonStyles.roundedPrimary}
                              >
                                修改密码
                              </button>
                            )}
                            {canOperate && (
                              <>
                                {/* 其他操作按钮 */}
                                {user.role === 'user' && (
                                  <button
                                    onClick={() =>
                                      handleSetAdmin(user.username)
                                    }
                                    disabled={isLoading(
                                      `setAdmin_${user.username}`
                                    )}
                                    className={`${buttonStyles.roundedPurple} ${
                                      isLoading(`setAdmin_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    设为管理
                                  </button>
                                )}
                                {user.role === 'admin' && (
                                  <button
                                    onClick={() =>
                                      handleRemoveAdmin(user.username)
                                    }
                                    disabled={isLoading(
                                      `removeAdmin_${user.username}`
                                    )}
                                    className={`${
                                      buttonStyles.roundedSecondary
                                    } ${
                                      isLoading(`removeAdmin_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    取消管理
                                  </button>
                                )}
                                {user.role !== 'owner' &&
                                  (!user.banned ? (
                                    <button
                                      onClick={() =>
                                        handleBanUser(user.username)
                                      }
                                      disabled={isLoading(
                                        `banUser_${user.username}`
                                      )}
                                      className={`${
                                        buttonStyles.roundedDanger
                                      } ${
                                        isLoading(`banUser_${user.username}`)
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                      }`}
                                    >
                                      封禁
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() =>
                                        handleUnbanUser(user.username)
                                      }
                                      disabled={isLoading(
                                        `unbanUser_${user.username}`
                                      )}
                                      className={`${
                                        buttonStyles.roundedSuccess
                                      } ${
                                        isLoading(`unbanUser_${user.username}`)
                                          ? 'opacity-50 cursor-not-allowed'
                                          : ''
                                      }`}
                                    >
                                      解封
                                    </button>
                                  ))}
                              </>
                            )}
                            {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
                            {canDeleteUser && (
                              <button
                                onClick={() => handleDeleteUser(user.username)}
                                className={buttonStyles.roundedDanger}
                              >
                                删除用户
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })()}
            </table>
          </div>

          {/* 用户列表分页 */}
          {!hasOldUserData && usersV2 && userTotalPages > 1 && (
            <div className='mt-4 flex items-center justify-between px-4'>
              <div className='text-sm text-gray-600 dark:text-gray-400'>
                {trimmedUserSearch
                  ? `搜索结果 ${userTotal} 个用户`
                  : `共 ${userTotal} 个用户`}
                ，第 {userPage} / {userTotalPages} 页
              </div>
              <div className='flex items-center space-x-2'>
                <button
                  onClick={() => fetchUsersV2(1, trimmedUserSearch)}
                  disabled={userPage === 1}
                  className={`px-3 py-1 text-sm rounded ${
                    userPage === 1
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  首页
                </button>
                <button
                  onClick={() => fetchUsersV2(userPage - 1, trimmedUserSearch)}
                  disabled={userPage === 1}
                  className={`px-3 py-1 text-sm rounded ${
                    userPage === 1
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  上一页
                </button>
                <button
                  onClick={() => fetchUsersV2(userPage + 1, trimmedUserSearch)}
                  disabled={userPage === userTotalPages}
                  className={`px-3 py-1 text-sm rounded ${
                    userPage === userTotalPages
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  下一页
                </button>
                <button
                  onClick={() =>
                    fetchUsersV2(userTotalPages, trimmedUserSearch)
                  }
                  disabled={userPage === userTotalPages}
                  className={`px-3 py-1 text-sm rounded ${
                    userPage === userTotalPages
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  末页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 查看用户设备弹窗 */}
      {showUserDevicesModal &&
        selectedDeviceUsername &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-10002 flex items-center justify-center p-4'
            onClick={() => {
              setShowUserDevicesModal(false);
              setSelectedDeviceUsername(null);
              setUserDevices([]);
            }}
            onTouchMove={(e) => e.preventDefault()}
            onWheel={(e) => e.preventDefault()}
            style={{ touchAction: 'none' }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col'
              onClick={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              style={{ touchAction: 'auto' }}
            >
              <div className='p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between'>
                <div>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    用户设备 - {selectedDeviceUsername}
                  </h3>
                  <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                    查看该用户当前仍有效的登录设备
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowUserDevicesModal(false);
                    setSelectedDeviceUsername(null);
                    setUserDevices([]);
                  }}
                  className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                >
                  <X size={24} />
                </button>
              </div>

              <div className='flex-1 overflow-y-auto overscroll-contain p-6'>
                {userDevicesLoading ? (
                  <div className='space-y-3'>
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                      />
                    ))}
                    <div className='text-center text-sm text-gray-500 dark:text-gray-400'>
                      加载中...
                    </div>
                  </div>
                ) : userDevices.length === 0 ? (
                  <div className='text-center py-10'>
                    <Monitor className='w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-3' />
                    <p className='text-sm text-gray-500 dark:text-gray-400'>
                      暂无登录设备
                    </p>
                  </div>
                ) : (
                  <div className='space-y-3'>
                    {userDevices
                      .slice()
                      .sort((a, b) => b.lastUsed - a.lastUsed)
                      .map((device) => {
                        const DeviceIcon = getDeviceIcon(device.deviceInfo);
                        return (
                          <div
                            key={device.tokenId}
                            className={`p-4 rounded-lg border ${
                              device.isCurrent
                                ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700'
                                : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            <div className='flex items-start gap-3'>
                              <DeviceIcon className='w-5 h-5 mt-0.5 text-gray-600 dark:text-gray-400 shrink-0' />
                              <div className='min-w-0 flex-1'>
                                <div className='flex items-center gap-2'>
                                  <div className='text-sm font-medium text-gray-900 dark:text-gray-100 break-all'>
                                    {device.deviceInfo || '未知设备'}
                                  </div>
                                  {device.isCurrent && (
                                    <span className='px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-full whitespace-nowrap'>
                                      当前设备
                                    </span>
                                  )}
                                </div>
                                <div className='mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-gray-500 dark:text-gray-400'>
                                  <div>
                                    登录时间:{' '}
                                    {new Date(device.createdAt).toLocaleString(
                                      'zh-CN'
                                    )}
                                  </div>
                                  <div>
                                    最后活跃:{' '}
                                    {new Date(device.lastUsed).toLocaleString(
                                      'zh-CN'
                                    )}
                                  </div>
                                  <div>
                                    过期时间:{' '}
                                    {new Date(device.expiresAt).toLocaleString(
                                      'zh-CN'
                                    )}
                                  </div>
                                </div>
                              </div>
                              {!device.isCurrent && (
                                <button
                                  onClick={() =>
                                    handleRevokeUserDevice(device.tokenId)
                                  }
                                  disabled={
                                    revokingUserDevice === device.tokenId
                                  }
                                  className='ml-2 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
                                >
                                  {revokingUserDevice === device.tokenId
                                    ? '登出中...'
                                    : '登出'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className='p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end'>
                <button
                  onClick={() => {
                    setShowUserDevicesModal(false);
                    setSelectedDeviceUsername(null);
                    setUserDevices([]);
                  }}
                  className={buttonStyles.secondary}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 配置用户采集源权限弹窗 */}
      {showConfigureApisModal &&
        selectedUser &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowConfigureApisModal(false);
              setSelectedUser(null);
              setSelectedApis([]);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    配置用户采集源权限 - {selectedUser.username}
                  </h3>
                  <button
                    onClick={() => {
                      setShowConfigureApisModal(false);
                      setSelectedUser(null);
                      setSelectedApis([]);
                    }}
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
                        配置说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400 mt-1'>
                      提示：全不选为无限制，选中的采集源将限制用户只能访问这些源
                    </p>
                  </div>
                </div>

                {/* 采集源选择 - 多列布局 */}
                <div className='mb-6'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                    选择可用的采集源：
                  </h4>
                  <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                    {config?.SourceConfig?.map((source) => (
                      <label
                        key={source.key}
                        className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                      >
                        <input
                          type='checkbox'
                          checked={selectedApis.includes(source.key)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedApis([...selectedApis, source.key]);
                            } else {
                              setSelectedApis(
                                selectedApis.filter((api) => api !== source.key)
                              );
                            }
                          }}
                          className='rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                        />
                        <div className='flex-1 min-w-0'>
                          <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                            {source.name}
                          </div>
                          {source.api && (
                            <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                              {extractDomain(source.api)}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 快速操作按钮 */}
                <div className='flex flex-wrap items-center justify-between mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg'>
                  <div className='flex space-x-2'>
                    <button
                      onClick={() => setSelectedApis([])}
                      className={buttonStyles.quickAction}
                    >
                      全不选（无限制）
                    </button>
                    <button
                      onClick={() => {
                        const allApis =
                          config?.SourceConfig?.filter(
                            (source) => !source.disabled
                          ).map((s) => s.key) || [];
                        setSelectedApis(allApis);
                      }}
                      className={buttonStyles.quickAction}
                    >
                      全选
                    </button>
                  </div>
                  <div className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择：
                    <span className='font-medium text-blue-600 dark:text-blue-400'>
                      {selectedApis.length > 0
                        ? `${selectedApis.length} 个源`
                        : '无限制'}
                    </span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowConfigureApisModal(false);
                      setSelectedUser(null);
                      setSelectedApis([]);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveUserApis}
                    disabled={isLoading(
                      `saveUserApis_${selectedUser?.username}`
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(`saveUserApis_${selectedUser?.username}`)
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    {isLoading(`saveUserApis_${selectedUser?.username}`)
                      ? '配置中...'
                      : '确认配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 添加用户组弹窗 */}
      {showAddUserGroupForm &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowAddUserGroupForm(false);
              setNewUserGroup({
                name: '',
                enabledApis: [],
                permissions: [...DEFAULT_GROUP_PERMISSIONS],
              });
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    添加新用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowAddUserGroupForm(false);
                      setNewUserGroup({
                        name: '',
                        enabledApis: [],
                        permissions: [...DEFAULT_GROUP_PERMISSIONS],
                      });
                    }}
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

                <div className='space-y-6'>
                  {/* 用户组名称 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      用户组名称
                    </label>
                    <input
                      type='text'
                      placeholder='请输入用户组名称'
                      value={newUserGroup.name}
                      onChange={(e) =>
                        setNewUserGroup((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                    />
                  </div>

                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      功能权限
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
                      {FEATURE_PERMISSION_OPTIONS.map((permission) => (
                        <label
                          key={permission.key}
                          className='flex items-start space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={newUserGroup.permissions.includes(
                              permission.key
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  permissions: [
                                    ...prev.permissions,
                                    permission.key,
                                  ],
                                }));
                              } else {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  permissions: prev.permissions.filter(
                                    (item) => item !== permission.key
                                  ),
                                }));
                              }
                            }}
                            className='mt-0.5 rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                              {permission.label}
                            </div>
                            <div className='text-xs text-gray-500 dark:text-gray-400'>
                              {permission.description}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className='mt-4 flex space-x-2'>
                      <button
                        type='button'
                        onClick={() =>
                          setNewUserGroup((prev) => ({
                            ...prev,
                            permissions: [],
                          }))
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选
                      </button>
                      <button
                        type='button'
                        onClick={() =>
                          setNewUserGroup((prev) => ({
                            ...prev,
                            permissions: [...DEFAULT_GROUP_PERMISSIONS],
                          }))
                        }
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  {/* 可用视频源 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      可用视频源
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                      {config?.SourceConfig?.map((source) => (
                        <label
                          key={source.key}
                          className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={newUserGroup.enabledApis.includes(
                              source.key
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  enabledApis: [
                                    ...prev.enabledApis,
                                    source.key,
                                  ],
                                }));
                              } else {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  enabledApis: prev.enabledApis.filter(
                                    (api) => api !== source.key
                                  ),
                                }));
                              }
                            }}
                            className='rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                              {source.name}
                            </div>
                            {source.api && (
                              <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                                {extractDomain(source.api)}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 快速操作按钮 */}
                    <div className='mt-4 flex space-x-2'>
                      <button
                        onClick={() =>
                          setNewUserGroup((prev) => ({
                            ...prev,
                            enabledApis: [],
                          }))
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选（无限制）
                      </button>
                      <button
                        onClick={() => {
                          const allApis =
                            config?.SourceConfig?.filter(
                              (source) => !source.disabled
                            ).map((s) => s.key) || [];
                          setNewUserGroup((prev) => ({
                            ...prev,
                            enabledApis: allApis,
                          }));
                        }}
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
                    <button
                      onClick={() => {
                        setShowAddUserGroupForm(false);
                        setNewUserGroup({
                          name: '',
                          enabledApis: [],
                          permissions: [...DEFAULT_GROUP_PERMISSIONS],
                        });
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleAddUserGroup}
                      disabled={
                        !newUserGroup.name.trim() ||
                        isLoading('userGroup_add_new')
                      }
                      className={`px-6 py-2.5 text-sm font-medium ${
                        !newUserGroup.name.trim() ||
                        isLoading('userGroup_add_new')
                          ? buttonStyles.disabled
                          : buttonStyles.primary
                      }`}
                    >
                      {isLoading('userGroup_add_new')
                        ? '添加中...'
                        : '添加用户组'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 编辑用户组弹窗 */}
      {showEditUserGroupForm &&
        editingUserGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowEditUserGroupForm(false);
              setEditingUserGroup(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    编辑用户组 - {editingUserGroup.name}
                  </h3>
                  <button
                    onClick={() => {
                      setShowEditUserGroupForm(false);
                      setEditingUserGroup(null);
                    }}
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

                <div className='space-y-6'>
                  {/* 可用视频源 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      可用视频源
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                      {config?.SourceConfig?.map((source) => (
                        <label
                          key={source.key}
                          className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={editingUserGroup.enabledApis.includes(
                              source.key
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        enabledApis: [
                                          ...prev.enabledApis,
                                          source.key,
                                        ],
                                      }
                                    : null
                                );
                              } else {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        enabledApis: prev.enabledApis.filter(
                                          (api) => api !== source.key
                                        ),
                                      }
                                    : null
                                );
                              }
                            }}
                            className='rounded-sm border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                              {source.name}
                            </div>
                            {source.api && (
                              <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                                {extractDomain(source.api)}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 快速操作按钮 */}
                    <div className='mt-4 flex space-x-2'>
                      <button
                        onClick={() =>
                          setEditingUserGroup((prev) =>
                            prev ? { ...prev, enabledApis: [] } : null
                          )
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选（无限制）
                      </button>
                      <button
                        onClick={() => {
                          const allApis =
                            config?.SourceConfig?.filter(
                              (source) => !source.disabled
                            ).map((s) => s.key) || [];
                          setEditingUserGroup((prev) =>
                            prev ? { ...prev, enabledApis: allApis } : null
                          );
                        }}
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      功能权限
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
                      {FEATURE_PERMISSION_OPTIONS.map((permission) => (
                        <label
                          key={permission.key}
                          className='flex items-start space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={editingUserGroup.permissions.includes(
                              permission.key
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        permissions: [
                                          ...prev.permissions,
                                          permission.key,
                                        ],
                                      }
                                    : null
                                );
                              } else {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        permissions: prev.permissions.filter(
                                          (item) => item !== permission.key
                                        ),
                                      }
                                    : null
                                );
                              }
                            }}
                            className='mt-0.5 rounded-sm border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                              {permission.label}
                            </div>
                            <div className='text-xs text-gray-500 dark:text-gray-400'>
                              {permission.description}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className='mt-4 flex space-x-2'>
                      <button
                        type='button'
                        onClick={() =>
                          setEditingUserGroup((prev) =>
                            prev ? { ...prev, permissions: [] } : null
                          )
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选
                      </button>
                      <button
                        type='button'
                        onClick={() =>
                          setEditingUserGroup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  permissions: [...DEFAULT_GROUP_PERMISSIONS],
                                }
                              : null
                          )
                        }
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
                    <button
                      onClick={() => {
                        setShowEditUserGroupForm(false);
                        setEditingUserGroup(null);
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleEditUserGroup}
                      disabled={isLoading(
                        `userGroup_edit_${editingUserGroup?.name}`
                      )}
                      className={`px-6 py-2.5 text-sm font-medium ${
                        isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                          ? buttonStyles.disabled
                          : buttonStyles.primary
                      }`}
                    >
                      {isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                        ? '保存中...'
                        : '保存修改'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 配置用户组弹窗 */}
      {showConfigureUserGroupModal &&
        selectedUserForGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowConfigureUserGroupModal(false);
              setSelectedUserForGroup(null);
              setSelectedUserGroups([]);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    配置用户组 - {selectedUserForGroup.username}
                  </h3>
                  <button
                    onClick={() => {
                      setShowConfigureUserGroupModal(false);
                      setSelectedUserForGroup(null);
                      setSelectedUserGroups([]);
                    }}
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
                        配置说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400 mt-1'>
                      提示：选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                    </p>
                  </div>
                </div>

                {/* 用户组选择 - 下拉选择器 */}
                <div className='mb-6'>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    选择用户组：
                  </label>
                  <select
                    value={
                      selectedUserGroups.length > 0 ? selectedUserGroups[0] : ''
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedUserGroups(value ? [value] : []);
                    }}
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'
                  >
                    <option value=''>无用户组（无限制）</option>
                    {userGroups.map((group) => (
                      <option key={group.name} value={group.name}>
                        {group.name}{' '}
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `(${group.enabledApis.length} 个源)`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                    选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                  </p>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowConfigureUserGroupModal(false);
                      setSelectedUserForGroup(null);
                      setSelectedUserGroups([]);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveUserGroups}
                    disabled={isLoading(
                      `saveUserGroups_${selectedUserForGroup?.username}`
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(
                        `saveUserGroups_${selectedUserForGroup?.username}`
                      )
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    {isLoading(
                      `saveUserGroups_${selectedUserForGroup?.username}`
                    )
                      ? '配置中...'
                      : '确认配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 删除用户组确认弹窗 */}
      {showDeleteUserGroupModal &&
        deletingUserGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowDeleteUserGroupModal(false);
              setDeletingUserGroup(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认删除用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowDeleteUserGroupModal(false);
                      setDeletingUserGroup(null);
                    }}
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
                  <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-red-600 dark:text-red-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                        危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-red-700 dark:text-red-400'>
                      删除用户组 <strong>{deletingUserGroup.name}</strong>{' '}
                      将影响所有使用该组的用户，此操作不可恢复！
                    </p>
                  </div>

                  {deletingUserGroup.affectedUsers.length > 0 ? (
                    <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4'>
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
                          ⚠️ 将影响 {deletingUserGroup.affectedUsers.length}{' '}
                          个用户：
                        </span>
                      </div>
                      <div className='space-y-1'>
                        {deletingUserGroup.affectedUsers.map((user, index) => (
                          <div
                            key={index}
                            className='text-sm text-yellow-700 dark:text-yellow-300'
                          >
                            • {user.username} ({user.role})
                          </div>
                        ))}
                      </div>
                      <p className='text-xs text-yellow-600 dark:text-yellow-400 mt-2'>
                        这些用户的用户组将被自动移除
                      </p>
                    </div>
                  ) : (
                    <div className='bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4'>
                      <div className='flex items-center space-x-2'>
                        <svg
                          className='w-5 h-5 text-green-600 dark:text-green-400'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M5 13l4 4L19 7'
                          />
                        </svg>
                        <span className='text-sm font-medium text-green-800 dark:text-green-300'>
                          ✅ 当前没有用户使用此用户组
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowDeleteUserGroupModal(false);
                      setDeletingUserGroup(null);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmDeleteUserGroup}
                    disabled={isLoading(
                      `userGroup_delete_${deletingUserGroup?.name}`
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }`}
                  >
                    {isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
                      ? '删除中...'
                      : '确认删除'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 删除用户确认弹窗 */}
      {showDeleteUserModal &&
        deletingUser &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowDeleteUserModal(false);
              setDeletingUser(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认删除用户
                  </h3>
                  <button
                    onClick={() => {
                      setShowDeleteUserModal(false);
                      setDeletingUser(null);
                    }}
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
                  <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-red-600 dark:text-red-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                        危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-red-700 dark:text-red-400'>
                      删除用户 <strong>{deletingUser}</strong>{' '}
                      将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！
                    </p>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3'>
                    <button
                      onClick={() => {
                        setShowDeleteUserModal(false);
                        setDeletingUser(null);
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleConfirmDeleteUser}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.danger}`}
                    >
                      确认删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 批量设置用户组弹窗 */}
      {showBatchUserGroupModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowBatchUserGroupModal(false);
              setSelectedUserGroup('');
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    批量设置用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowBatchUserGroupModal(false);
                      setSelectedUserGroup('');
                    }}
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
                  <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4'>
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
                        批量操作说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400'>
                      将为选中的 <strong>{selectedUsers.size} 个用户</strong>{' '}
                      设置用户组，选择"无用户组"为无限制
                    </p>
                  </div>

                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      选择用户组：
                    </label>
                    <select
                      onChange={(e) => setSelectedUserGroup(e.target.value)}
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'
                      value={selectedUserGroup}
                    >
                      <option value=''>无用户组（无限制）</option>
                      {userGroups.map((group) => (
                        <option key={group.name} value={group.name}>
                          {group.name}{' '}
                          {group.enabledApis && group.enabledApis.length > 0
                            ? `(${group.enabledApis.length} 个源)`
                            : ''}
                        </option>
                      ))}
                    </select>
                    <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                      选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                    </p>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowBatchUserGroupModal(false);
                      setSelectedUserGroup('');
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleBatchSetUserGroup(selectedUserGroup)}
                    disabled={isLoading('batchSetUserGroup')}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading('batchSetUserGroup')
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    {isLoading('batchSetUserGroup') ? '设置中...' : '确认设置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 通用弹窗组件 */}
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
