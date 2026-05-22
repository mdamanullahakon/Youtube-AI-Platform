'use client';

import { useState, useEffect, useRef } from 'react';

const API_URL = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || 'http://localhost:4000';
const CHECK_INTERVAL = 15000;

export function ApiConnectivity({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(true);
  const [lastCheck, setLastCheck] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
        if (mounted.current) {
          setConnected(res.ok);
          setLastCheck(Date.now());
        }
      } catch {
        if (mounted.current) {
          setConnected(false);
          setLastCheck(Date.now());
        }
      }
      if (mounted.current) {
        timeoutId = setTimeout(check, CHECK_INTERVAL);
      }
    }

    check();

    return () => {
      mounted.current = false;
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <>
      {!connected && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="bg-red-500/90 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-red-200 animate-pulse" />
            <span>API offline — check backend on {API_URL}</span>
            <button
              onClick={() => window.location.reload()}
              className="text-white/80 hover:text-white underline text-xs ml-2"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
