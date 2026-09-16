const native = require('vm').runInThisContext(
  '({Request, Response, Headers, ReadableStream, TextEncoder, TextDecoder})'
);
Object.assign(global, native);
