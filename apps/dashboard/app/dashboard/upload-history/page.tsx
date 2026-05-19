'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/store';
import type { UploadHistoryItem } from '@/lib/types';

export default function UploadHistoryPage() {
  const [page, setPage] = useState(0);
  const perPage = 10;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['upload-history'],
    queryFn: async () => {
      const res = await apiClient('/api/upload/history');
      if (!res.success) throw new Error(res.message || 'Failed to load upload history');
      return res;
    },
    retry: 1,
    staleTime: 60000,
  });

  const history: UploadHistoryItem[] = data?.history || [];
  const totalPages = Math.max(1, Math.ceil(history.length / perPage));
  const paginated = history.slice(page * perPage, (page + 1) * perPage);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Upload History</h1>
        <p className="text-muted mt-1">Track your YouTube uploads and performance</p>
      </div>

      {isError && (
        <div className="glow-card rounded-xl p-4 text-sm text-yellow-400 bg-yellow-400/5 border border-yellow-400/20">
          Could not load upload history. Make sure the API server is running.
        </div>
      )}

      {isLoading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glow-card rounded-xl p-5 animate-pulse">
            <div className="h-5 bg-card-border rounded w-3/4 mb-3" />
            <div className="h-4 bg-card-border rounded w-1/2" />
          </div>
        ))
      ) : paginated.length === 0 ? (
        <div className="text-center py-20 text-muted">
          <p className="text-5xl mb-4">📤</p>
          <p className="text-lg">No uploads yet</p>
          <p className="mt-2">Generated videos will appear here after publishing</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginated.map((item: UploadHistoryItem) => (
            <div key={item.id} className="glow-card rounded-xl p-5 animate-in">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{item.title || item.project?.topic}</h3>
                  <p className="text-sm text-muted mt-1">
                    {item.videoId && (
                      <a
                        href={`https://youtube.com/watch?v=${item.videoId}`}
                        target="_blank"
                        className="text-primary hover:underline"
                      >
                        Watch on YouTube →
                      </a>
                    )}
                  </p>
                </div>
                <div className="text-right text-sm text-muted">
                  <p>{new Date(item.createdAt).toLocaleDateString()}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    item.status === 'uploaded' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>
              {item.project?.analytics && (
                <div className="flex gap-4 mt-3 text-sm text-muted">
                  <span>👁️ {item.project.analytics.views}</span>
                  <span>❤️ {item.project.analytics.likes}</span>
                  <span>💬 {item.project.analytics.comments}</span>
                </div>
              )}
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 rounded bg-card-border text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-3 py-1 text-sm text-muted">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 rounded bg-card-border text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
