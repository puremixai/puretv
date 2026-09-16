'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { logger } from '@/lib/logger';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

interface VersionCheckContextType {
  updateStatus: UpdateStatus | null;
  isChecking: boolean;
}

const VersionCheckContext = createContext<VersionCheckContextType>({
  updateStatus: null,
  isChecking: true,
});

export const useVersionCheck = () => useContext(VersionCheckContext);

export const VersionCheckProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (error) {
        logger.warn('版本检查失败:', error);
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <VersionCheckContext.Provider value={{ updateStatus, isChecking }}>
      {children}
    </VersionCheckContext.Provider>
  );
};
