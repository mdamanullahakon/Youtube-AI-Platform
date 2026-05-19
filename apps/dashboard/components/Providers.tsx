'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useState } from 'react';
import { AuthInit } from './AuthInit';
import { ApiConnectivity } from './ApiConnectivity';
import { ConsoleGuard } from './ConsoleGuard';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ConsoleGuard>
        <ApiConnectivity>
          <AuthInit>
            {children}
          </AuthInit>
        </ApiConnectivity>
      </ConsoleGuard>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#111118',
            color: '#ededed',
            border: '1px solid #1a1a24',
          },
        }}
      />
    </QueryClientProvider>
  );
}
