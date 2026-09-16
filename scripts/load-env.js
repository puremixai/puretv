function applyAdminUsername(env = process.env) {
  // Windows already defines USERNAME for the OS account; use an explicit application override.
  if (env.ADMIN_USERNAME) env.USERNAME = env.ADMIN_USERNAME;
}

function loadAppEnv() {
  require('@next/env').loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== 'production'
  );
  applyAdminUsername();
}

module.exports = { loadAppEnv, applyAdminUsername };
