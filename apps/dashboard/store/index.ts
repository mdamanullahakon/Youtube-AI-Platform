'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isHydrated: boolean;
  sessionChecked: boolean;
  setHydrated: () => void;
  setSessionChecked: () => void;
  setAuth: (token: string, user: User, refreshToken?: string) => void;
  setTokens: (token: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      isHydrated: false,
      sessionChecked: false,
      setHydrated: () => set({ isHydrated: true }),
      setSessionChecked: () => set({ sessionChecked: true }),
      setAuth: (token, user, refreshToken) => set({ token, user, refreshToken: refreshToken || null, sessionChecked: true }),
      setTokens: (token, refreshToken) => set({ token, refreshToken }),
      logout: () => {
        set({ token: null, refreshToken: null, user: null });
        if (typeof window !== 'undefined') {
          try { localStorage.removeItem('auth-storage'); } catch {}
          try { sessionStorage.clear(); } catch {}
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            state.isHydrated = true;
          }
        };
      },
    }
  )
);

// NEXT_PUBLIC_* env vars must be available at build time in Next.js.
// This fallback is only for dev — ensure apps/dashboard/.env sets NEXT_PUBLIC_API_URL.
const API_URL = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || 'http://localhost:4000';
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pendingRequests = new Map<string, Promise<any>>();

function isNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('load failed') || msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ERR_NETWORK');
}

function getUserFriendlyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('ERR_CONNECTION_REFUSED')) return 'API server is not running. Start the backend on port 4000.';
  if (msg.includes('ERR_NETWORK')) return 'Network error — check your connection and API server status.';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('load failed')) return 'Unable to reach the API server. Is the backend running?';
  return msg;
}

async function fetchWithRetry(url: string, options: RequestInit, retries: number): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error: unknown) {
      if (attempt < retries && isNetworkError(error)) {
        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[apiClient] Request failed (attempt ${attempt}/${retries}), retrying in ${delay}ms:`, url);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Request failed after all retries');
}

export async function apiClient(endpoint: string, options: RequestInit = {}) {
  const state = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };

  const requestKey = `${options.method || 'GET'}:${endpoint}`;

  if (options.method === undefined || options.method === 'GET') {
    const pending = pendingRequests.get(requestKey);
    if (pending) {
      return pending;
    }
    // Signal that the caller cancelled — remove from pending cache
    const origSignal = options.signal;
    if (origSignal) {
      const onAbort = () => {
        pendingRequests.delete(requestKey);
        origSignal.removeEventListener('abort', onAbort);
      };
      origSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execute = async (): Promise<any> => {
    try {
      let response = await fetchWithRetry(`${API_URL}${endpoint}`, fetchOptions, MAX_RETRIES);
      const currentState = useAuthStore.getState();

      if (response.status === 401 && currentState.refreshToken) {
        try {
          const refreshRes = await fetchWithRetry(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: currentState.refreshToken }),
            credentials: 'include',
            signal: options.signal,
          }, 2);

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (refreshData.success && refreshData.token) {
              useAuthStore.getState().setTokens(refreshData.token, refreshData.refreshToken);
              headers['Authorization'] = `Bearer ${refreshData.token}`;
              response = await fetchWithRetry(`${API_URL}${endpoint}`, { ...options, headers, credentials: 'include' }, 2);
            }
          }
        } catch {
          // JWT refresh failed, fall through to logout
        }
      }

      if (response.status === 401) {
        useAuthStore.getState().logout();
        return { success: false, message: 'Session expired' };
      }

      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        // Normalize: if response has top-level token/user but caller expects data.*,
        // ensure data wrapper exists. If response has data wrapper but caller expects
        // top-level fields, hoist token/user/refreshToken.
        if (parsed && typeof parsed === 'object') {
          if (parsed.data && !parsed.token) {
            if (parsed.data.token) parsed.token = parsed.data.token;
            if (parsed.data.refreshToken) parsed.refreshToken = parsed.data.refreshToken;
            if (parsed.data.user) parsed.user = parsed.data.user;
            if (parsed.data.expiresAt) parsed.expiresAt = parsed.data.expiresAt;
          } else if (parsed.token && !parsed.data) {
            parsed.data = {};
            if (parsed.token) parsed.data.token = parsed.token;
            if (parsed.refreshToken) parsed.data.refreshToken = parsed.refreshToken;
            if (parsed.user) parsed.data.user = parsed.user;
            if (parsed.expiresAt) parsed.data.expiresAt = parsed.expiresAt;
          }
        }
        return parsed;
      } catch {
        return {
          success: false,
          message: 'Invalid server response',
          ...(process.env.NODE_ENV === 'development' ? { raw: text.substring(0, 200) } : {}),
        };
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, message: 'Request cancelled', code: 'ABORTED' };
      }
      const errorMessage = getUserFriendlyError(error);
      if (isNetworkError(error)) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[apiClient] API unreachable at ${API_URL}${endpoint} — ${errorMessage}`);
        }
      }
      return { success: false, message: errorMessage, code: 'NETWORK_ERROR' };
    }
  };

  const promise = execute();

  if (options.method === undefined || options.method === 'GET') {
    pendingRequests.set(requestKey, promise);
    promise.finally(() => pendingRequests.delete(requestKey));
  }

  return promise;
}
