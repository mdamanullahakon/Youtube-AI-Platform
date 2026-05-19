import Link from 'next/link';

export default function NotFound() {
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
        <h1 style={{ fontSize: 72, fontWeight: 800, color: '#8b5cf6', marginBottom: 16 }}>404</h1>
        <p style={{ fontSize: 18, color: '#71717a', marginBottom: 24 }}>Page not found</p>
        <Link href="/" style={{
          padding: '12px 24px',
          background: '#8b5cf6',
          color: 'white',
          borderRadius: 8,
          display: 'inline-block',
        }}>
          Go Home
        </Link>
      </div>
    </div>
  );
}
