'use client';

import RouteError from '@/components/RouteError';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang='zh-CN'>
      <body
        style={{
          margin: 0,
          background: '#080b12',
          color: '#f1f5f9',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <RouteError reset={reset} />
      </body>
    </html>
  );
}
