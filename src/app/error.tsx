'use client';

import RouteError from '@/components/RouteError';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <RouteError reset={reset} />;
}
