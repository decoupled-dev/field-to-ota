import { useCallback, useEffect, useRef, useState } from "react";
import type { F2FEvent } from "./api";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/** Fetch on mount / when deps change; optional polling interval in ms. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => {
    fnRef
      .current()
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => setError(e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setLoading(true);
    reload();
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { data, error, loading, reload, setData };
}

/** Subscribe to an SSE endpoint. Reports whether the stream is healthy so callers can fall back to polling. */
export function useEventStream(url: string | null, onEvent: (e: F2FEvent) => void): boolean {
  const [healthy, setHealthy] = useState(true);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") {
      setHealthy(false);
      return;
    }
    const es = new EventSource(url);
    es.onopen = () => setHealthy(true);
    es.onerror = () => setHealthy(false);
    es.onmessage = (m) => {
      try {
        handler.current(JSON.parse(m.data) as F2FEvent);
      } catch {
        /* ignore keep-alives */
      }
    };
    return () => es.close();
  }, [url]);

  return healthy;
}

export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("f2f-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
    setDark(next);
  };
  return [dark, toggle];
}
