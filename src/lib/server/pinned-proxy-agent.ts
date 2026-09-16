import type { ClientRequest } from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';

/** CONNECT the validated numeric destination; a proxy must not resolve it again. */
export class PinnedProxyAgent extends HttpsProxyAgent<string> {
  constructor(
    proxy: URL,
    private readonly destination: { address: string; hostname: string },
    lookup: NonNullable<import('http').AgentOptions['lookup']>,
  ) {
    super(proxy, { keepAlive: false, lookup, timeout: 30_000 });
  }

  override connect(
    req: ClientRequest,
    options: Parameters<HttpsProxyAgent<string>['connect']>[1],
  ) {
    return super.connect(
      req,
      options.secureEndpoint
        ? {
            ...options,
            host: this.destination.address,
            servername: this.destination.hostname,
          }
        : { ...options, host: this.destination.address },
    );
  }
}
