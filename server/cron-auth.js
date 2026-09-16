function getCronSecret() {
  return process.env.CRON_SECRET || process.env.CRON_PASSWORD || '';
}

function isCronAuthorized(authorization, pathPassword) {
  const secret = getCronSecret();
  if (!secret) return false;
  return authorization === `Bearer ${secret}` || pathPassword === secret;
}

module.exports = { getCronSecret, isCronAuthorized };
