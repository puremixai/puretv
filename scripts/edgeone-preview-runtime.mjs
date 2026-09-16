import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { Transform } from 'node:stream';
import vm from 'node:vm';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

function decodeOriginResponse(response) {
  const encoding = response.headers.get('content-encoding');
  if (!response.body || !encoding) return response;
  const decoders = {
    gzip: createGunzip,
    deflate: createInflate,
    br: createBrotliDecompress,
  };
  const encodings = encoding
    .split(',')
    .map((value) => value.trim().toLowerCase());
  if (encodings.some((value) => !decoders[value])) {
    throw new Error('Unsupported local origin content encoding: ' + encoding);
  }
  let body = response.body;
  for (const value of encodings.reverse()) {
    body = body.pipeThrough(Transform.toWeb(decoders[value]()));
  }
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// EdgeOne's generated entry registers a fetch listener. Run that same entry,
// including its middleware response/rewrite/header handling, before local SSR.
export function createEdgeOneRuntime(file, env) {
  let code;
  try {
    code = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      'Generated EdgeOne middleware is missing. Build first, or explicitly use --ssr-only (authentication is not verified).',
      { cause: error }
    );
  }
  if (!code.includes('/* edgeone-middleware-manifest-matcher */')) {
    throw new Error(
      'Generated EdgeOne middleware has not passed required patches. Run node scripts/edgeone-build.mjs --patch-only.'
    );
  }
  const listeners = [];
  // Node requires duplex for streaming Request bodies; EdgeOne's Fetch API does
  // not. This local compatibility class retains the native stream semantics.
  class EdgeRequest extends Request {
    constructor(input, init) {
      super(input, init?.body ? { ...init, duplex: 'half' } : init);
    }
  }
  const sandbox = {
    Request: EdgeRequest,
    Response,
    Headers,
    URL,
    URLSearchParams,
    ReadableStream,
    WritableStream,
    TransformStream,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    crypto: webcrypto,
    atob,
    btoa,
    Buffer,
    console,
    performance,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    process: { env: { ...env } },
    fetch,
    addEventListener(type, listener) {
      if (type === 'fetch') listeners.push(listener);
    },
  };
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox);
  new vm.Script(code, { filename: file }).runInContext(context, {
    timeout: 5000,
  });
  if (
    listeners.length !== 1 ||
    typeof context.executeMiddleware !== 'function'
  ) {
    throw new Error(
      'Generated EdgeOne middleware has an unsupported entry shape; refusing an authentication preview.'
    );
  }
  return async function run(request, originFetch) {
    let response;
    const event = {
      request,
      waitUntil(promise) {
        Promise.resolve(promise).catch((error) =>
          console.error('[edgeone waitUntil]', error)
        );
      },
      respondWith(value) {
        if (response !== undefined)
          throw new Error('EdgeOne entry responded more than once');
        response = Promise.resolve(value);
      },
    };
    await listeners[0](event, {
      fetch: async (input, init) => {
        const next = new EdgeRequest(input, init);
        if (new URL(next.url).origin !== new URL(request.url).origin) {
          throw new Error(
            'Local EdgeOne preview only supports same-origin middleware rewrites'
          );
        }
        // Real network fetch decodes compression before the generated wrapper
        // merges middleware headers. The direct local SSR call returns raw bytes.
        return decodeOriginResponse(await originFetch(next));
      },
    });
    if (!response) throw new Error('EdgeOne entry did not call respondWith');
    const result = await response;
    if (!(result instanceof Response))
      throw new Error('EdgeOne entry did not return a Response');
    return result;
  };
}
