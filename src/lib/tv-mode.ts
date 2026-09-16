export function isTVModeEnabled() {
  return process.env.ENABLE_TV_MODE !== 'false';
}

export function isTVPathname(pathname: string): boolean {
  return pathname === '/tv' || pathname.startsWith('/tv/');
}

/** 按当前路径选择登录页：TV 端走 /tv/login，其余走 /login */
export function resolveLoginPath(pathname: string): string {
  return isTVPathname(pathname) ? '/tv/login' : '/login';
}

export function isLoginPathname(pathname: string): boolean {
  return pathname === '/login' || pathname === '/tv/login';
}
