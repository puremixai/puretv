'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- A full reload also recovers a failed root router. */

export default function RouteError({ reset }: { reset: () => void }) {
  return (
    <main
      role='alert'
      style={{
        minHeight: '60vh',
        display: 'grid',
        placeContent: 'center',
        gap: 20,
        padding: 32,
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ color: '#22d3ee', letterSpacing: 4, fontWeight: 700 }}>
          PureTV
        </p>
        <h1 style={{ fontSize: 24, margin: '16px 0 8px' }}>暂时无法加载</h1>
        <p style={{ opacity: 0.7 }}>请稍后重试，或返回首页继续浏览。</p>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={reset}
          style={{
            border: 0,
            borderRadius: 8,
            padding: '12px 20px',
            background: '#22d3ee',
            color: '#061018',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          重新加载
        </button>
        <a
          href='/'
          style={{
            border: '1px solid currentColor',
            borderRadius: 8,
            padding: '12px 20px',
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          返回首页
        </a>
      </div>
    </main>
  );
}
