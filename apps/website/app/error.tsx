'use client';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      color: '#ededed',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 48, fontWeight: 800, marginBottom: 16 }}>Something went wrong</h1>
        <p style={{ color: '#71717a', marginBottom: 24 }}>{error.message}</p>
        <button onClick={reset} style={{
          padding: '12px 24px',
          background: '#8b5cf6',
          color: 'white',
          borderRadius: 8,
          border: 'none',
          cursor: 'pointer',
          fontSize: 16,
        }}>
          Try Again
        </button>
      </div>
    </div>
  );
}
