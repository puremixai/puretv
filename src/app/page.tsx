import { cookies } from 'next/headers';

import { getInitialBannerSeed } from '@/lib/server/banner-data';

import HomePageClient from '@/components/home/HomePageClient';

export default async function Home() {
  const cookieStore = await cookies();
  const initialBannerEnabled =
    cookieStore.get('puretv_home_banner')?.value !== 'false';
  const initialBannerSeed = initialBannerEnabled
    ? await getInitialBannerSeed()
    : null;

  return (
    <HomePageClient
      initialBannerData={initialBannerSeed?.data ?? null}
      initialBannerEnabled={initialBannerEnabled}
      initialBannerArtwork={initialBannerSeed?.artwork}
    />
  );
}
