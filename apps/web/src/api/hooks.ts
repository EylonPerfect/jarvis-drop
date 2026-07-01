import { useEffect, useState, useCallback } from "react";
import { api } from "./client";

// Generic fetch hook: loads a GET endpoint, exposes { data, loading, error, reload }.
export function useApi<T>(path: string, deps: unknown[] = []): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => load(), [load]);

  return { data, loading, error, reload: load };
}

// Poll an endpoint on an interval (live telemetry: gauges, health, logs).
export function usePoll<T>(path: string, ms: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .get<T>(path)
        .then((d) => alive && setData(d))
        .catch(() => {});
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, ms]);
  return data;
}
