'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UsePollingOptions {
  interval: number;
  enabled?: boolean;
}

interface UsePollingResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastUpdated: Date | null;
}

export function usePolling<T>(
  fetchFn: () => Promise<T>,
  { interval, enabled = true }: UsePollingOptions
): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isFirstFetch = useRef(true);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const doFetch = useCallback(async () => {
    if (isFirstFetch.current) {
      setLoading(true);
    }
    try {
      const result = await fetchFnRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      if (isFirstFetch.current) {
        setLoading(false);
        isFirstFetch.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    doFetch();
    if (interval <= 0) return;
    const id = setInterval(doFetch, interval);
    return () => clearInterval(id);
  }, [doFetch, interval, enabled]);

  const refetch = useCallback(() => {
    doFetch();
  }, [doFetch]);

  return { data, loading, error, refetch, lastUpdated };
}
