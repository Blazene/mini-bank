export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 'NETWORK_ERROR',
    public retryAfter = 0,
    public details: string[] = []
  ) {
    super(message);
  }
  get uncertain() {
    return this.status === 0 || this.status === 408 || this.status >= 500;
  }
}
export type RequestOptions = {
  body?: unknown;
  token?: string | null;
  key?: string;
  signal?: AbortSignal;
};
export function apiBase(value = import.meta.env.VITE_API_BASE || '/api/v1') {
  if (value === '/api/v1') return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/api\/v1\/?$/.test(url.pathname)
    )
      throw new Error();
    return value.replace(/\/$/, '');
  } catch {
    throw new Error('VITE_API_BASE must be /api/v1 or an HTTPS API URL ending in /api/v1.');
  }
}
export function createApi(
  getToken: () => string | null,
  onUnauthorized: (sentToken: string) => void,
  fetcher: typeof fetch = (...args) => fetch(...args)
) {
  return {
    async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
      const token = options.token === undefined ? getToken() : options.token;
      const base = apiBase();
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          method,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)])
            : AbortSignal.timeout(90_000),
          headers: {
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.key ? { 'Idempotency-Key': options.key } : {}),
          },
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch {
        throw new ApiError(
          'We couldn’t reach the bank. Free hosting may be waking up. Please try again.'
        );
      }
      if (response.status === 401 && token) onUnauthorized(token);
      let data: { error?: { message?: string; code?: string; details?: { message?: string }[] } };
      try {
        data = await response.json();
      } catch {
        throw new ApiError(
          'The server returned an unreadable response. Check activity before retrying a money movement.'
        );
      }
      if (!response.ok)
        throw new ApiError(
          data.error?.message || 'This request couldn’t be completed.',
          response.status,
          data.error?.code || 'API_ERROR',
          Number(response.headers.get('retry-after')) || 0,
          response.status === 400 && Array.isArray(data.error?.details)
            ? data.error.details
                .map((item) => (typeof item?.message === 'string' ? item.message : ''))
                .filter(Boolean)
                .slice(0, 5)
            : []
        );
      return data as T;
    },
  };
}
export type Api = ReturnType<typeof createApi>;
export const errorMessage = (error: unknown) =>
  error instanceof ApiError && error.details.length
    ? `${error.message}. ${error.details.join(' ')}`
    : error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.';
