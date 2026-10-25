import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { useSafeWrite } from './useSafeWrite';
const { request, setNavigationLocked } = vi.hoisted(() => ({
  request: vi.fn(),
  setNavigationLocked: vi.fn(),
}));
vi.mock('../context/Session', () => ({ useSession: () => ({ api: { request } }) }));
vi.mock('../context/Bank', () => ({ useBank: () => ({ setNavigationLocked }) }));
afterEach(() => {
  vi.useRealTimers();
  request.mockReset();
});
it('keeps the same immutable body/key after an uncertain write, including a rate-limited retry', async () => {
  vi.useFakeTimers();
  request
    .mockRejectedValueOnce(new ApiError('network'))
    .mockRejectedValueOnce(new ApiError('rate', 429, 'RATE_LIMITED', 2))
    .mockResolvedValueOnce({ id: 'done' });
  const { result } = renderHook(() => useSafeWrite<{ id: string }>());
  const body = { amount: 1050 };
  await act(async () => {
    await result.current.submit('/transactions/deposit', body);
  });
  body.amount = 9999;
  expect(result.current.uncertain).toBe(true);
  await act(async () => {
    await result.current.submit('/transactions/transfer', { amount: 3000 });
  });
  expect(result.current.uncertain).toBe(true);
  expect(result.current.retrySeconds).toBe(2);
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });
  await act(async () => {
    await result.current.submit('/transactions/transfer', { amount: 3000 });
  });
  expect(request.mock.calls[2]).toEqual(request.mock.calls[0]);
  expect(request.mock.calls[0][2].body).toEqual({ amount: 1050 });
  expect(result.current.result).toEqual({ id: 'done' });
});
it('ignores duplicate clicks while a write is in flight', async () => {
  let resolve!: (value: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result } = renderHook(() => useSafeWrite());
  let pending: Promise<unknown>;
  act(() => {
    pending = result.current.submit('/loans/applications', { principal: 100000 });
  });
  await act(async () => {
    await result.current.submit('/loans/applications', { principal: 200000 });
  });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve({ ok: true });
    await pending;
  });
});
it('allows correcting a definitive validation failure as a new intent', async () => {
  request.mockRejectedValueOnce(new ApiError('invalid', 422)).mockResolvedValueOnce({ ok: true });
  const { result } = renderHook(() => useSafeWrite());
  await act(async () => {
    await result.current.submit('/x', { amount: 0 });
  });
  await act(async () => {
    await result.current.submit('/x', { amount: 1 });
  });
  expect(request.mock.calls[0][2].key).not.toBe(request.mock.calls[1][2].key);
  expect(result.current.uncertain).toBe(false);
});
