'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfigStore, type ConfigSection } from '@/store/config-store';
import { useAuthStore, apiClient } from '@/store';

interface ConfigGuardProps {
  children: React.ReactNode;
  requiredSection?: ConfigSection;
  fallback?: React.ReactNode;
}

export function ConfigGuard({ children, requiredSection, fallback }: ConfigGuardProps) {
  const router = useRouter();
  const { token } = useAuthStore();
  const { configs, setConfigs, fetched } = useConfigStore();
  const [checking, setChecking] = useState(!fetched);

  useEffect(() => {
    if (fetched) return;

    apiClient('/api/config/status').then((data) => {
      if (data.success && Array.isArray(data.data)) {
        setConfigs(data.data);
      }
    }).catch(() => {}).finally(() => setChecking(false));
  }, [fetched, setConfigs]);

  if (checking) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!fetched) {
    return <>{children}</>;
  }

  if (requiredSection) {
    const sectionConfigs = configs.filter((c) => c.section === requiredSection);
    const sectionMissing = sectionConfigs.filter((c) => !c.present);

    if (sectionMissing.length > 0) {
      if (fallback) return <>{fallback}</>;

      return (
        <div className="glow-card rounded-xl p-8 text-center max-w-lg mx-auto my-12">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold mb-2">Configuration Required</h2>
          <p className="text-muted mb-6">
            This feature requires <strong>{sectionMissing.map((c) => c.label).join(', ')}</strong> to be configured.
          </p>
          <button
            onClick={() => router.push('/setup')}
            className="btn-primary"
          >
            Open Setup Wizard
          </button>
        </div>
      );
    }
  }

  return <>{children}</>;
}
