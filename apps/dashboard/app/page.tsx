'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';

export default function HomePage() {
  const router = useRouter();
  const { token, isHydrated } = useAuthStore();
  const redirected = useRef(false);

  useEffect(() => {
    if (isHydrated && !redirected.current) {
      redirected.current = true;
      router.replace(token ? '/dashboard' : '/login');
    }
  }, [isHydrated, token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold gradient-text mb-4">YouTube AI Platform</h1>
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    </div>
  );
}
