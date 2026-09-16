'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SavedAIComments } from '@/lib/ai-comments.types';

export function useSavedAIComments(
  movieName: string,
  movieYear = '',
  movieInfo = ''
) {
  const [job, setJob] = useState<SavedAIComments>({
    status: 'idle',
    comments: [],
    total: 0,
    movieName,
    isAiGenerated: true,
  });
  const [restoring, setRestoring] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(true);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const canGenerate = useRef(false);
  const cancelRequests = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
  }, []);

  const request = useCallback(
    async (action: 'read' | 'generate' | 'regenerate') => {
      if (action !== 'read' && !canGenerate.current) return;
      const current = ++sequence.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setRequestError(null);
      setCanRetry(true);
      setReading(action === 'read');
      if (action !== 'read') setSubmitting(true);
      try {
        const movie = {
          name: movieName,
          year: movieYear,
          info: movieInfo,
          count: 10,
        };
        const params = new URLSearchParams({
          name: movieName,
          year: movieYear,
          count: '10',
        });
        const response = await fetch(
          action === 'read' ? `/api/ai-comments?${params}` : '/api/ai-comments',
          {
            method: action === 'read' ? 'GET' : 'POST',
            cache: 'no-store',
            signal: abort.signal,
            ...(action === 'read'
              ? {}
              : {
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...movie,
                    regenerate: action === 'regenerate',
                  }),
                }),
          }
        );
        const data = await response.json();
        if (current !== sequence.current) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            canGenerate.current = false;
            setJob((previous) => ({ ...previous, canGenerate: false }));
          }
          setCanRetry(response.status >= 500 || response.status === 429);
          throw new Error(data.error || '读取评论失败');
        }
        canGenerate.current = data.canGenerate === true;
        setJob(data);
      } catch (error) {
        if (current === sequence.current && !abort.signal.aborted) {
          setRequestError(
            error instanceof Error ? error.message : '连接失败，正在重试读取'
          );
        }
      } finally {
        if (current === sequence.current) {
          setRestoring(false);
          setSubmitting(false);
          setReading(false);
        }
      }
    },
    [movieName, movieYear, movieInfo]
  );

  useEffect(() => {
    canGenerate.current = false;
    setJob({
      status: 'idle',
      comments: [],
      total: 0,
      movieName,
      isAiGenerated: true,
    });
    setRestoring(true);
    void request('read');
    return cancelRequests;
  }, [movieName, request, cancelRequests]);

  const pending = job.status === 'queued' || job.status === 'running';
  useEffect(() => {
    if (
      restoring ||
      reading ||
      submitting ||
      !canRetry ||
      (!pending && !requestError)
    )
      return;
    const timer = setTimeout(
      () => {
        void request('read');
      },
      requestError ? 5000 : 2000
    );
    return () => clearTimeout(timer);
  }, [
    pending,
    job,
    requestError,
    canRetry,
    restoring,
    reading,
    submitting,
    request,
  ]);

  return {
    job,
    canGenerate: job.canGenerate === true,
    restoring,
    loading: submitting || pending,
    error: requestError || job.error || null,
    readFailed: Boolean(requestError),
    refresh: () => request('read'),
    start: () => request(job.status === 'failed' ? 'regenerate' : 'generate'),
    regenerate: () => request('regenerate'),
  };
}
