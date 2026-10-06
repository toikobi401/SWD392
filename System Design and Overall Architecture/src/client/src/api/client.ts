/**
 * «boundary» / I/O — HTTP client
 *
 * The client's single point of contact with the server (§7.4.1). Pages and
 * hooks never call axios directly, so the auth header, the token refresh and
 * the error shape are handled in exactly one place.
 */
import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import type { ApiErrorBody, AuthTokens } from '../types';

const ACCESS_KEY = 'hms.accessToken';
const REFRESH_KEY = 'hms.refreshToken';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(tokens: Pick<AuthTokens, 'accessToken' | 'refreshToken'>): void {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** A typed error the UI can branch on by `code` rather than by message text. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Serialises concurrent refreshes: if three requests expire at once, only one
// refresh call is made and the others wait for it.
let refreshInFlight: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const body = error.response?.data?.error;

    // BR-03 — an expired access token is recoverable; try once, silently.
    if (body?.code === 'TOKEN_EXPIRED' && !original?._retried && tokenStore.refresh) {
      original._retried = true;

      try {
        refreshInFlight ??= api
          .post<AuthTokens>('/auth/refresh', { refreshToken: tokenStore.refresh })
          .then((res) => {
            tokenStore.set(res.data);
            return res.data.accessToken;
          })
          .finally(() => {
            refreshInFlight = null;
          });

        const accessToken = await refreshInFlight;
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api.request(original);
      } catch {
        // The refresh token is dead too — the session is over. Forget it, but
        // do NOT redirect: a returning guest browsing rooms with an old token
        // must not be thrown onto the sign-in page. Pages that need a session
        // redirect on their own (RequireAuth); public pages just carry on.
        tokenStore.clear();
        throw new ApiError('SESSION_EXPIRED', 'Your session has ended — please sign in again', 401);
      }
    }

    throw new ApiError(
      body?.code ?? 'NETWORK_ERROR',
      body?.message ?? error.message ?? 'Request failed',
      error.response?.status ?? 0,
      body?.details,
    );
  },
);
