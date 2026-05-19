'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, apiClient } from '@/store';

export function AuthInit({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isHydrated, token, sessionChecked, setHydrated, setSessionChecked } = useAuthStore();
  const checked = useRef(false);

  useEffect(() => {
    if (!isHydrated) {
      setHydrated();
    }
  }, [isHydrated, setHydrated]);

  useEffect(() => {
    if (isHydrated && !sessionChecked && !checked.current) {
      checked.current = true;
      if (!token) {
        const controller = new AbortController();
        apiClient('/api/auth/me', { signal: controller.signal })
          .then((res) => {
            if (res.success === false && (res.message === 'Session expired' || res.code === 'TOKEN_EXPIRED')) {
              useAuthStore.getState().logout();
              return;
            }
            const user = res.data?.user || res.user;
            const t = res.data?.token || res.token;
            const refreshToken = res.data?.refreshToken || res.refreshToken;
            if (res.success && user && t) {
              useAuthStore.getState().setAuth(t, user, refreshToken);
            }
          })
          .catch(() => {})
          .finally(() => {
            setSessionChecked();
          });
        return () => controller.abort();
      }
      setSessionChecked();
    }
  }, [isHydrated, token, sessionChecked, setSessionChecked, router]);

  return <>{children}</>;
}
