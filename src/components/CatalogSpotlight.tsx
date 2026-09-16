'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { DoubanItem } from '@/lib/types';
import {
  tryApplyBangumiImageFallback,
  tryApplyDoubanImageFallback,
} from '@/lib/utils';

import ProxyImage from '@/components/ProxyImage';

function posterFallback(
  event: React.SyntheticEvent<HTMLImageElement>,
  url: string
) {
  if (tryApplyDoubanImageFallback(event.currentTarget, url)) return;
  if (tryApplyBangumiImageFallback(event.currentTarget, url)) return;
  event.currentTarget.style.visibility = 'hidden';
}

export default function CatalogSpotlight({
  items,
  category,
}: {
  items: DoubanItem[];
  category: string;
}) {
  const featured = items[0];
  if (!featured) return null;
  const searchHref = (item: DoubanItem) =>
    `/search?q=${encodeURIComponent(item.title)}`;

  return (
    <section className='cinema-spotlight' aria-label={`${category}精选`}>
      {featured.poster && (
        <ProxyImage
          className='cinema-spotlight-backdrop'
          originalSrc={featured.poster}
          alt=''
          aria-hidden='true'
          referrerPolicy='no-referrer'
          onError={(event) => posterFallback(event, featured.poster)}
        />
      )}
      <div className='cinema-spotlight-copy'>
        <span className='cinema-eyebrow'>{category} · 发现好故事</span>
        <h2>{featured.title}</h2>
        <p>
          {[
            featured.year,
            featured.rate && featured.rate !== '0'
              ? `评分 ${featured.rate}`
              : null,
            category,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <Link href={searchHref(featured)} className='cinema-primary-link'>
          查找片源 <ArrowRight size={16} aria-hidden='true' />
        </Link>
      </div>
      <div className='cinema-spotlight-art'>
        {items
          .slice(0, 2)
          .filter((item) => item.poster)
          .map((item) => (
            <Link
              key={item.id}
              href={searchHref(item)}
              aria-label={`搜索 ${item.title}`}
            >
              <ProxyImage
                originalSrc={item.poster}
                alt={item.title}
                referrerPolicy='no-referrer'
                onError={(event) => posterFallback(event, item.poster)}
              />
            </Link>
          ))}
      </div>
    </section>
  );
}
