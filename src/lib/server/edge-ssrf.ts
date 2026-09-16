/** Workers cannot pin a Node DNS lookup; allow only operator-selected upstream hosts. */
export async function validateProxyUrlServerSide(
  input: string
): Promise<boolean> {
  try {
    const url = new URL(input);
    const allowed = (process.env.MEDIA_PROXY_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase());
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      allowed.includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
