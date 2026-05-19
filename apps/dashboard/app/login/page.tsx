'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore, apiClient } from '@/store';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const router = useRouter();
  const { token, isHydrated, setAuth } = useAuthStore();
  const redirected = useRef(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isHydrated && token && !redirected.current) {
      redirected.current = true;
      router.replace('/dashboard');
    }
  }, [isHydrated, token, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiClient('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (data.success) {
        setAuth(data.token, data.user, data.refreshToken);
        toast.success('Welcome back!');
        router.push('/dashboard');
      } else {
        const msg = data.errors ? data.errors.join(', ') : data.message || 'Login failed';
        toast.error(msg);
      }
    } catch {
      toast.error('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  if (isHydrated && token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold gradient-text">YouTube AI Platform</h1>
          <p className="text-muted mt-2">Sign in to your account</p>
        </div>
        <form onSubmit={handleSubmit} className="glow-card rounded-2xl p-8 space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" placeholder="you@example.com" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input-field" placeholder="••••••••" required />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-center text-sm text-muted">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-primary hover:underline">Register</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
