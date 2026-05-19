'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProjectCard } from '@/components/ProjectCard';
import { GenerateButton } from '@/components/GenerateButton';
import { apiClient } from '@/store';
import type { Project } from '@/lib/types';

export default function ProjectsPage() {
  const [page, setPage] = useState(0);
  const perPage = 9;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await apiClient('/api/analytics/projects');
      if (!res.success) throw new Error(res.message || 'Failed to load projects');
      return res;
    },
    retry: 1,
    staleTime: 60000,
  });

  const projects: Project[] = data?.projects || [];
  const totalPages = Math.max(1, Math.ceil(projects.length / perPage));
  const paginated = projects.slice(page * perPage, (page + 1) * perPage);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted mt-1">Manage your AI-generated video projects</p>
        </div>
        <GenerateButton />
      </div>

      {isError && (
        <div className="glow-card rounded-xl p-4 text-sm text-yellow-400 bg-yellow-400/5 border border-yellow-400/20">
          Could not load projects. Make sure the API server is running.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glow-card rounded-xl p-5 animate-pulse">
                <div className="h-5 bg-card-border rounded w-3/4 mb-3" />
                <div className="h-4 bg-card-border rounded w-1/2" />
              </div>
            ))
          : paginated.map((project: Project) => (
              <ProjectCard
                key={project.id}
                id={project.id}
                topic={project.topic}
                status={project.status}
                viralScore={project.viralScore}
                views={project.analytics?.views}
                createdAt={project.createdAt}
              />
            ))}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
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

      {!isLoading && projects.length === 0 && (
        <div className="text-center py-20 text-muted">
          <p className="text-5xl mb-4">🎬</p>
          <p className="text-lg">No projects yet</p>
          <p className="mt-2">Click &quot;Generate New Content&quot; to create your first AI video project</p>
        </div>
      )}
    </div>
  );
}
