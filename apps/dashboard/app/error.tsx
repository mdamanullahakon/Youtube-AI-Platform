'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 max-w-md mx-auto p-8">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted text-sm">
          {error.message || 'An unexpected error occurred'}
        </p>
        <button onClick={reset} className="btn-primary">
          Try Again
        </button>
      </div>
    </div>
  );
}
