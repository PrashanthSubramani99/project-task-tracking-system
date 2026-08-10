import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Fetch a GET endpoint and keep it in state.
 * Returns `reload` so mutations can refresh without a full remount.
 */
export function useFetch(path, params, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const key = JSON.stringify(params ?? {});

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!path) return;
      if (!quiet) setLoading(true);
      try {
        const result = await api.get(path, params);
        if (alive.current) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (alive.current) setError(err);
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, key],
  );

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { data, loading, error, reload: load, setData };
}

/** Debounce a fast-changing value, e.g. a search box. */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Persist small bits of view state (filters, chosen tab) across visits. */
export function useLocalState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(`teamtrack.${key}`);
      return stored === null ? initial : JSON.parse(stored);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`teamtrack.${key}`, JSON.stringify(value));
    } catch {
      /* private mode, quota — not worth surfacing */
    }
  }, [key, value]);
  return [value, setValue];
}
