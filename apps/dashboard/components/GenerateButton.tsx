'use client';

import { useState } from 'react';
import { apiClient } from '@/store';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

export function GenerateButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleGenerate() {
    setLoading(true);
    try {
      const data = await apiClient('/api/videos/generate/new', { method: 'POST' });
      if (data.success && data.project) {
        toast.success('Content generation started!');
        router.push(`/dashboard/projects/${data.project.id}`);
      } else {
        toast.error(data.message || 'Generation failed');
      }
    } catch {
      toast.error('Failed to start generation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={loading}
      className="btn-primary flex items-center gap-2"
    >
      {loading ? (
        <>
          <span className="animate-spin inline-block">⚡</span>
          Generating...
        </>
      ) : (
        <>
          <span>🚀</span>
          Generate New Content
        </>
      )}
    </button>
  );
}
