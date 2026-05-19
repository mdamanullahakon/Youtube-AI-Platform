import Link from 'next/link';

const DASHBOARD_URL = 'http://localhost:3000';

export default function LandingPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      color: '#ededed',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <header style={{
        borderBottom: '1px solid #1a1a24',
        padding: '20px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h1 style={{ background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 700 }}>
          YouTube AI
        </h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href={`${DASHBOARD_URL}/login`} style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: '1px solid #1a1a24',
            color: '#ededed',
            textDecoration: 'none',
          }}>
            Sign In
          </a>
          <a href={`${DASHBOARD_URL}/register`} style={{
            padding: '8px 20px',
            borderRadius: 8,
            background: '#8b5cf6',
            color: 'white',
            textDecoration: 'none',
          }}>
            Get Started
          </a>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: '80px auto', padding: '0 40px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 48, fontWeight: 800, lineHeight: 1.2, marginBottom: 16 }}>
          Autonomous AI
          <span style={{ background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}> YouTube</span>
          {' '}Content OS
        </h2>
        <p style={{ fontSize: 18, color: '#71717a', maxWidth: 600, margin: '0 auto 40px' }}>
          Research viral topics, generate scripts, create videos, optimize SEO, and publish automatically.
          A complete AI-powered YouTube growth agency in one platform.
        </p>
        <a href={`${DASHBOARD_URL}/register`} style={{
          display: 'inline-block',
          padding: '14px 32px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
          color: 'white',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 16,
        }}>
          Start Creating Free
        </a>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 24,
          marginTop: 80,
          textAlign: 'left',
        }}>
          {[
            { icon: '🤖', title: 'AI Agents', desc: '8 specialized AI agents work together to create viral content automatically' },
            { icon: '📊', title: 'Smart Analytics', desc: 'Continuous learning from performance data to improve future content' },
            { icon: '🚀', title: 'Auto Publishing', desc: 'Direct YouTube integration with scheduling and multi-channel support' },
          ].map(f => (
            <div key={f.title} style={{
              background: '#111118',
              border: '1px solid #1a1a24',
              borderRadius: 16,
              padding: 24,
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ margin: '0 0 8px' }}>{f.title}</h3>
              <p style={{ color: '#71717a', fontSize: 14, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
