'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/dashboard/ai-control', label: 'AI Control Center', icon: '🧠' },
  { href: '/dashboard/projects', label: 'Projects', icon: '🎬' },
  { href: '/dashboard/viral-opportunities', label: 'Viral Intel', icon: '🔥' },
  { href: '/dashboard/analytics', label: 'Growth Analytics', icon: '📈' },
  { href: '/dashboard/agents', label: 'AI Agents', icon: '🤖' },
  { href: '/dashboard/upload-history', label: 'Upload History', icon: '📤' },
  { href: '/dashboard/deploy', label: 'Deploy', icon: '🚀' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚙️' },
];

export function Sidebar({ configMissing }: { configMissing?: boolean }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside className="w-64 min-h-screen bg-card border-r border-card-border flex flex-col">
      <div className="p-6 border-b border-card-border">
        <Link href="/dashboard" className="text-xl font-bold gradient-text">
          YouTube AI
        </Link>
        <p className="text-xs text-muted mt-1">Autonomous Content OS</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all ${
                isActive
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted hover:text-foreground hover:bg-card-border/50'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
        <Link
          href="/setup"
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all mt-2 ${
            pathname === '/setup'
              ? 'bg-primary/10 text-primary border border-primary/20'
              : configMissing
                ? 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/5 border border-yellow-500/20'
                : 'text-muted hover:text-foreground hover:bg-card-border/50'
          }`}
        >
          <span>🔧</span>
          <span>Setup Wizard</span>
          {configMissing && (
            <span className="ml-auto w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          )}
        </Link>
      </nav>

      <div className="p-4 border-t border-card-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm">
            {user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{user?.email || 'User'}</p>
            <p className="text-xs text-muted">{user?.role || 'Free Plan'}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full mt-2 px-4 py-2 text-sm text-muted hover:text-accent transition-colors rounded-xl hover:bg-card-border/50"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
