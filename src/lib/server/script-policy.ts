export function isServerScriptExecutionEnabled(): boolean {
  const edge =
    process.env.BUILD_TARGET === 'cloudflare' ||
    process.env.BUILD_TARGET === 'edgeone' ||
    process.env.CF_PAGES === '1' ||
    process.env.EDGEONE_PAGES === '1';
  return !edge && process.env.ALLOW_SERVER_SCRIPTS === 'true';
}

export function assertServerScriptExecutionEnabled(): void {
  if (!isServerScriptExecutionEnabled()) {
    throw new Error(
      '服务器脚本执行未启用；仅站长可在受信任的 Node 部署中配置 ALLOW_SERVER_SCRIPTS=true'
    );
  }
}
