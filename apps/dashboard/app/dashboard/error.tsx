'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <h2 className="text-xl font-semibold">Dashboard Error</h2>
        <p className="text-muted text-sm max-w-md">
          {error.message || 'An unexpected error occurred loading this page'}
        </p>
        <button onClick={reset} className="btn-primary">
          Reload
        </button>
      </div>
    </div>
  );
}
