import { useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from './api';
import { useSession } from '../context/Session';
import { useBank } from '../context/Bank';
// One immutable intent per attempt/retry. Never silently retry a financial write.
export function useSafeWrite<T>() {
  const { api } = useSession();
  const { setNavigationLocked } = useBank();
  const intent = useRef<{ path: string; body: unknown; key: string } | null>(null),
    running = useRef(false),
    unknown = useRef(false);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<T | null>(null),
    [retryAt, setRetryAt] = useState(0),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    setNavigationLocked(busy || uncertain);
    return () => setNavigationLocked(false);
  }, [busy, uncertain, setNavigationLocked]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  useEffect(() => {
    if (!busy && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, uncertain]);
  async function submit(path: string, body: unknown) {
    if (running.current || Date.now() < retryAt) return;
    running.current = true;
    setBusy(true);
    setError('');
    intent.current ??= { path, body: structuredClone(body), key: crypto.randomUUID() };
    const current = intent.current;
    try {
      const data = await api.request<T>('POST', current.path, {
        body: current.body,
        key: current.key,
      });
      setResult(data);
      unknown.current = false;
      setUncertain(false);
      intent.current = null;
      return data;
    } catch (err) {
      // A rejected retry (e.g. 429) says nothing about the original uncertain write.
      const unknownOutcome = unknown.current || !(err instanceof ApiError) || err.uncertain;
      unknown.current = unknownOutcome;
      setUncertain(unknownOutcome);
      if (!unknownOutcome) intent.current = null;
      if (err instanceof ApiError && err.retryAfter > 0) {
        setRetryAt(Date.now() + err.retryAfter * 1000);
        setClock(Date.now());
      }
      setError(errorMessage(err));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const reset = () => {
    if (!running.current && !uncertain) {
      intent.current = null;
      setResult(null);
      setError('');
    }
  };
  return {
    submit,
    busy,
    uncertain,
    error,
    result,
    reset,
    locked: busy || uncertain,
    retrySeconds: Math.max(0, Math.ceil((retryAt - clock) / 1000)),
  };
}
