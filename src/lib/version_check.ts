

'use client';

import type { ChangelogEntry } from '@/lib/changelog';
import { logger } from '@/lib/logger';
import { PROJECT_CHANGELOG_URL, PROJECT_NAME } from '@/lib/project';
import { compareVersionStrings, parseVersion } from '@/lib/semantic-version';
import { CURRENT_VERSION } from '@/lib/version';

export enum UpdateStatus {
  HAS_UPDATE = 'has_update',
  NO_UPDATE = 'no_update',
  FETCH_FAILED = 'fetch_failed',
}

function parseProjectChangelog(content: string): ChangelogEntry[] {
  const lines = content.trim().split(/\r?\n/);
  // Only accept this project's release feed, not legacy or upstream feeds.
  if (lines[0].trim() !== '# ' + PROJECT_NAME) {
    throw new Error('远程日志尚未包含 PureTV 发布记录');
  }

  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let section: 'added' | 'changed' | 'fixed' | null = null;

  for (const line of lines) {
    const text = line.trim();
    if (text.startsWith('## [')) {
      const match = text.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/);
      if (!match || !parseVersion(match[1])) {
        throw new Error('远程日志的版本格式无效');
      }
      current = {
        version: match[1],
        date: match[2],
        added: [],
        changed: [],
        fixed: [],
      };
      entries.push(current);
      section = null;
    } else if (text.startsWith('### ')) {
      section =
        text === '### Added'
          ? 'added'
          : text === '### Changed'
            ? 'changed'
            : text === '### Fixed'
              ? 'fixed'
              : null;
    } else if (current && section && text.startsWith('- ')) {
      current[section].push(text.slice(2));
    }
  }

  if (entries.length === 0) throw new Error('远程日志尚无发布记录');
  return entries;
}

/** Notifications and the version panel share the same PureTV release feed. */
export async function fetchRemoteChangelog(): Promise<ChangelogEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(PROJECT_CHANGELOG_URL + '?_t=' + Date.now(), {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return parseProjectChangelog(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    const entries = await fetchRemoteChangelog();
    return compareVersions(entries[0].version);
  } catch (error) {
    logger.warn('PureTV 版本检查失败:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

export function compareVersions(remoteVersion: string): UpdateStatus {
  const comparison = compareVersionStrings(
    remoteVersion.trim(),
    CURRENT_VERSION,
  );
  if (comparison === null) return UpdateStatus.FETCH_FAILED;
  return comparison > 0 ? UpdateStatus.HAS_UPDATE : UpdateStatus.NO_UPDATE;
}
