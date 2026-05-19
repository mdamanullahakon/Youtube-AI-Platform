'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuthStore, apiClient } from '@/store';
import { useConfigStore, type ConfigSection } from '@/store/config-store';

const FEATURE_BLOCK_MAP: Record<string, ConfigSection> = {
  '/dashboard/agents': 'gemini',
  '/dashboard/analytics': 'gemini',
  '/dashboard/projects': 'gemini',
  '/dashboard/upload-history': 'youtube',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((s) => s.token);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const configs = useConfigStore((s) => s.configs);
  const setConfigs = useConfigStore((s) => s.setConfigs);
  const fetched = useConfigStore((s) => s.fetched);
  const redirectAttempted = useRef(false);

  useEffect(() => {
    if (isHydrated && sessionChecked && !token && !redirectAttempted.current) {
      redirectAttempted.current = true;
      router.replace('/login');
    }
  }, [isHydrated, sessionChecked, token, router]);

  useEffect(() => {
    if (!token || fetched) return;
    let cancelled = false;
    const controller = new AbortController();
    apiClient('/api/config/status', { signal: controller.signal }).then((data) => {
      if (cancelled) return;
      if (data.success && Array.isArray(data.data)) {
        setConfigs(data.data);
      } else {
        useConfigStore.getState().setFetched(true);
      }
    }).catch((err) => {
      if (!cancelled && err?.code !== 'ABORTED') {
        useConfigStore.getState().setFetched(true);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [token, fetched, setConfigs]);

  const missingCount = configs.filter((c) => !c.present).length;
  const blockedSection = FEATURE_BLOCK_MAP[pathname];

  let featureBlocked = false;
  let blockedSectionKey: ConfigSection | null = null;
  if (blockedSection) {
    const sectionConfigs = configs.filter((c) => c.section === blockedSection);
    if (sectionConfigs.length > 0 && sectionConfigs.some((c) => !c.present)) {
      featureBlocked = true;
      blockedSectionKey = blockedSection;
    }
  }

  if (!isHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!token) return null;

  return (
    <div className="flex min-h-screen">
      <Sidebar configMissing={missingCount > 0} />
      <main className="flex-1 flex flex-col overflow-auto">
        {missingCount > 0 && (
          <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-8 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-yellow-400">
                <span className="font-semibold">{missingCount} service(s) need configuration.</span>
                {' '}Some features may be limited until configured.
              </p>
              <button
                onClick={() => router.push('/setup')}
                className="text-sm text-primary hover:underline font-medium"
              >
                Open Setup Wizard
              </button>
            </div>
          </div>
        )}

        {featureBlocked && blockedSectionKey && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-8 py-6">
            <div className="text-center max-w-md mx-auto space-y-3">
              <div className="text-3xl">🔒</div>
              <h3 className="text-lg font-semibold text-foreground">Configuration Required</h3>
              <p className="text-sm text-muted">
                This page requires <strong>{blockedSectionKey === 'gemini' ? 'Gemini API' : blockedSectionKey === 'youtube' ? 'YouTube OAuth' : blockedSectionKey}</strong> to be configured.
              </p>
              <button
                onClick={() => router.push('/setup')}
                className="btn-primary text-sm"
              >
                Go to Setup Wizard
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 p-8">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
