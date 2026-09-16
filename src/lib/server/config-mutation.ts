import { AsyncLocalStorage } from 'async_hooks';
import { NextRequest, NextResponse } from 'next/server';

import { configWriteRegistry, ConfigWriteState } from '../config-write-context';
export {
  checkMutationVersion,
  recordConfigConflict,
} from '../config-write-context';
const context = (configWriteRegistry.__puretvConfigWrites ||
  new AsyncLocalStorage<ConfigWriteState>()) as AsyncLocalStorage<ConfigWriteState>;
configWriteRegistry.__puretvConfigWrites = context;
export function withConfigMutation<T extends unknown[]>(
  handler: (request: NextRequest, ...args: T) => Promise<Response>
) {
  return (request: NextRequest, ...args: T): Promise<Response> =>
    context.run(
      { version: request.headers.get('x-config-version') },
      async () => {
        const response = await handler(request, ...args);
        const failure = context.getStore()?.failure;
        return failure
          ? NextResponse.json(
              { error: failure.error },
              { status: failure.status }
            )
          : response;
      }
    );
}
