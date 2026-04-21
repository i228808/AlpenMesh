import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_API_BASE = 'http://localhost:8080';
const DEFAULT_REPORTING_BASE = 'http://localhost:8001';

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

async function timedFetch(url, { timeoutMs = 2500, init } = {}) {
  const controller = new AbortController();
  const start = nowMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(init || {}), signal: controller.signal });
    const latencyMs = Math.round(nowMs() - start);
    return { ok: res.ok, status: res.status, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}

export function useBackendHealth({
  apiBase = DEFAULT_API_BASE,
  reportingBase = DEFAULT_REPORTING_BASE,
  pollIntervalMs = 8000,
} = {}) {
  const [api, setApi] = useState({
    state: 'unknown',
    latencyMs: null,
    lastCheckedAt: null,
    error: null,
  });
  const [reporting, setReporting] = useState({
    state: 'unknown',
    latencyMs: null,
    lastCheckedAt: null,
    error: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timerRef = useRef(null);

  const checkOnce = useCallback(async () => {
    setIsRefreshing(true);

    const checkedAt = Date.now();
    const [apiRes, reportingRes] = await Promise.allSettled([
      timedFetch(`${apiBase}/api/status`, { timeoutMs: 2500 }),
      timedFetch(`${reportingBase}/alerts?limit=1`, { timeoutMs: 2500 }),
    ]);

    if (apiRes.status === 'fulfilled') {
      setApi({
        state: apiRes.value.ok ? 'ok' : 'error',
        latencyMs: apiRes.value.latencyMs,
        lastCheckedAt: checkedAt,
        error: apiRes.value.ok ? null : `HTTP ${apiRes.value.status}`,
      });
    } else {
      setApi({ state: 'error', latencyMs: null, lastCheckedAt: checkedAt, error: 'Unreachable' });
    }

    if (reportingRes.status === 'fulfilled') {
      setReporting({
        state: reportingRes.value.ok ? 'ok' : 'error',
        latencyMs: reportingRes.value.latencyMs,
        lastCheckedAt: checkedAt,
        error: reportingRes.value.ok ? null : `HTTP ${reportingRes.value.status}`,
      });
    } else {
      setReporting({
        state: 'error',
        latencyMs: null,
        lastCheckedAt: checkedAt,
        error: 'Unreachable',
      });
    }

    setIsRefreshing(false);
  }, [apiBase, reportingBase]);

  useEffect(() => {
    checkOnce();
    timerRef.current = setInterval(checkOnce, pollIntervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkOnce, pollIntervalMs]);

  const overall = useMemo(() => {
    if (api.state === 'ok' && reporting.state === 'ok') return 'ok';
    if (api.state === 'unknown' || reporting.state === 'unknown') return 'unknown';
    return 'error';
  }, [api.state, reporting.state]);

  return {
    overall,
    api,
    reporting,
    isRefreshing,
    refresh: checkOnce,
  };
}
