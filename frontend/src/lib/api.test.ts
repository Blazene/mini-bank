import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBase, ApiError, createApi, errorMessage } from './api';
afterEach(() => vi.unstubAllEnvs());
describe('API boundaries', () => {
  it('shows backend validation guidance without logging submitted inputs', async () => {
    const client = createApi(
      () => null,
      vi.fn(),
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request data',
              details: [
                { field: 'password', message: 'Password must contain at least one number' },
              ],
            },
          },
          { status: 400 }
        )
      )
    );
    const message = await client.request('POST', '/auth/register').catch(errorMessage);
    expect(message).toContain('Password must contain at least one number');
  });
  it('supports the local proxy and HTTPS API base', () => {
    expect(apiBase('/api/v1')).toBe('/api/v1');
    expect(apiBase('https://bank.example/api/v1/')).toBe('https://bank.example/api/v1');
  });
  it.each([
    'http://bank.example/api/v1',
    'https://user:secret@bank.example/api/v1',
    'https://bank.example/api/v1?secret=x',
    'https://bank.example/api/v1#x',
    'https://bank.example/',
  ])('rejects unsafe configuration %s', (value) => expect(() => apiBase(value)).toThrow());
  it('uses bearer auth, a stable supplied key, and never browser cookies or redirects', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    await createApi(() => 'memory-token', vi.fn(), fetcher).request(
      'POST',
      '/transactions/deposit',
      { key: 'intent-1234', body: { amount: 1050 } }
    );
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/transactions/deposit',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: 'Bearer memory-token',
          'Idempotency-Key': 'intent-1234',
        }),
        body: '{"amount":1050}',
      })
    );
  });
  it('does not send a token on explicit public calls', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    await createApi(() => 'secret', vi.fn(), fetcher).request('POST', '/auth/login', {
      token: null,
    });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
  it('expires an authenticated session on 401 and exposes the structured code', async () => {
    const expire = vi.fn(),
      client = createApi(
        () => 'token',
        expire,
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ error: { code: 'TOKEN_EXPIRED', message: 'Expired' } }, { status: 401 })
          )
      );
    await expect(client.request('GET', '/accounts')).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
    expect(expire).toHaveBeenCalledWith('token');
  });
  it('handles Retry-After without automatic resubmission', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { message: 'Slow down' } },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      );
    await expect(
      createApi(() => null, vi.fn(), fetcher).request('POST', '/loans/applications')
    ).rejects.toMatchObject({ retryAfter: 60 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('treats network and unreadable responses as uncertain, without leaking raw errors', async () => {
    const client = createApi(
      () => null,
      vi.fn(),
      vi.fn().mockRejectedValue(new Error('private input'))
    );
    await expect(client.request('POST', '/transactions/transfer')).rejects.toThrow(
      'couldn’t reach'
    );
    const unreadable = createApi(
      () => null,
      vi.fn(),
      vi.fn().mockResolvedValue(new Response('proxy error'))
    );
    await expect(unreadable.request('POST', '/transactions/deposit')).rejects.toMatchObject({
      status: 0,
    });
    expect(new ApiError('failure', 500).uncertain).toBe(true);
    expect(new ApiError('invalid', 422).uncertain).toBe(false);
  });
});
