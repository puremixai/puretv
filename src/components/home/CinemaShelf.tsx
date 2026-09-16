'use client';

import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Children, ReactNode, useEffect, useId, useRef, useState } from 'react';

export default function CinemaShelf({
  title,
  subtitle,
  href,
  variant = 'poster',
  children,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  variant?: 'poster' | 'ranked' | 'landscape';
  children: ReactNode;
}) {
  'use memo';
  const row = useRef<HTMLDivElement>(null);
  const id = useId();
  const [edges, setEdges] = useState({ start: true, end: true });
  const count = Children.count(children);
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () =>
      setEdges({
        start: element.scrollLeft <= 2,
        end:
          element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [count]);
  const scroll = (direction: number) => {
    const element = row.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * 0.85,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };
  return (
    <section
      className='cinema-shelf'
      data-variant={variant}
      aria-labelledby={`${id}-title`}
    >
      <div className='cinema-shelf-heading'>
        <div>
          {subtitle && <p className='cinema-shelf-eyebrow'>{subtitle}</p>}
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <div className='cinema-shelf-actions'>
          {href && (
            <Link href={href}>
              查看全部 <ChevronRight size={15} aria-hidden='true' />
            </Link>
          )}
          <div className='cinema-shelf-arrows'>
            <button
              type='button'
              disabled={edges.start}
              onClick={() => scroll(-1)}
              aria-label={`向左浏览${title}`}
              aria-controls={id}
            >
              <ArrowLeft size={17} />
            </button>
            <button
              type='button'
              disabled={edges.end}
              onClick={() => scroll(1)}
              aria-label={`向右浏览${title}`}
              aria-controls={id}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>
      <div
        className='cinema-shelf-track'
        ref={row}
        id={id}
        tabIndex={0}
        aria-label={`${title}片单`}
      >
        {children}
      </div>
    </section>
  );
}
