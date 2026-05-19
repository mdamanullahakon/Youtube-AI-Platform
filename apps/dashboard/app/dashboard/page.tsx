'use client';

import { useQuery } from '@tanstack/react-query';
import { StatCard } from '@/components/StatCard';
import { ActivityChart } from '@/components/ActivityChart';
import { ProjectCard } from '@/components/ProjectCard';
import { GenerateButton } from '@/components/GenerateButton';
import { apiClient } from '@/store';
import type { Project } from '@/lib/types';

function useBackendHealth() {
  return useQuery({
    queryKey: ['backend-health'],
    queryFn: async () => {
      const res = await apiClient('/api/health');
      if (!res.success) throw new Error('Backend unreachable');
      return res;
    },
    retry: 2,
    retryDelay: 2000,
    staleTime: 15000,
    refetchInterval: 30000,
  });
}

function useWeeklyStats() {
  return useQuery({
    queryKey: ['weekly-stats'],
    queryFn: async () => {
      const res = await apiClient('/api/analytics/dashboard');
      if (!res.success) throw new Error(res.message || 'Failed to load stats');
      return res;
    },
    retry: 1,
    staleTime: 60000,
  });
}

function useRecentProjects() {
  return useQuery({
    queryKey: ['recent-projects'],
    queryFn: async () => {
      const res = await apiClient('/api/analytics/projects');
      if (!res.success) throw new Error(res.message || 'Failed to load projects');
      return res;
    },
    retry: 1,
    staleTime: 60000,
  });
}

function useMonetization() {
  return useQuery({
    queryKey: ['monetization'],
    queryFn: async () => {
      const res = await apiClient('/api/business/monetization');
      if (!res.success) return null;
      return res.data;
    },
    retry: 1,
    staleTime: 300000,
  });
}

export default function DashboardPage() {
  const { data: healthData, isLoading: healthLoading } = useBackendHealth();
  const { data: statsData, isLoading: statsLoading, isError: statsError } = useWeeklyStats();
  const { data: projectsData, isLoading: projectsLoading, isError: projectsError } = useRecentProjects();
  const { data: monetizationData } = useMonetization();

  const stats = statsData?.stats;
  const projects = projectsData?.projects || [];

  const chartData = stats?.weeklyViews
    ? (stats.weeklyViews as { name: string; views: number; likes: number }[])
    : undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted mt-1">Your AI content ecosystem overview</p>
        </div>
        <GenerateButton />
      </div>

      {!healthLoading && healthData?.status === 'unhealthy' && (
        <div className="rounded-xl p-4 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20">
          <span className="font-semibold">Backend connectivity issue:</span> Some services may be degraded. Data will refresh automatically when restored.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Projects" value={stats?.totalProjects || 0} icon="🎬" loading={statsLoading} />
        <StatCard title="Total Views" value={stats?.totalViews || 0} icon="👁️" loading={statsLoading} />
        <StatCard title="Total Likes" value={stats?.totalLikes || 0} icon="❤️" loading={statsLoading} />
        <StatCard title="Subscribers" value={stats?.subscribersGained || 0} icon="📈" loading={statsLoading} />
      </div>

      {statsError && (
        <div className="glow-card rounded-xl p-4 text-sm text-yellow-400 bg-yellow-400/5 border border-yellow-400/20">
          Could not load analytics data. Some stats may be unavailable.
        </div>
      )}

      <ActivityChart data={chartData} />

      {monetizationData && (
        <div className="glow-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">💰 Monetization Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted">Est. RPM</p>
              <p className="text-2xl font-bold">${monetizationData.rpm?.toFixed(2) || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted">Est. CPM</p>
              <p className="text-2xl font-bold">${monetizationData.cpm?.toFixed(2) || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted">Est. Monthly Views</p>
              <p className="text-2xl font-bold">{(monetizationData.monthlyViews || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted">Est. Monthly Earnings</p>
              <p className="text-2xl font-bold text-green-400">${monetizationData.estimatedEarnings?.toFixed(2) || '$0.00'}</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-4">Recent Projects</h2>
        {projectsError && (
          <div className="glow-card rounded-xl p-4 text-sm text-yellow-400 bg-yellow-400/5 border border-yellow-400/20 mb-4">
            Could not load projects. Showing cached data if available.
          </div>
        )}
        <div className="space-y-3">
          {projectsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glow-card rounded-xl p-5 animate-pulse">
                <div className="h-5 bg-card-border rounded w-3/4 mb-3" />
                <div className="h-4 bg-card-border rounded w-1/2" />
              </div>
            ))
          ) : projects.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <p className="text-4xl mb-3">🎬</p>
              <p>No projects yet. Click &quot;Generate New Content&quot; to start!</p>
            </div>
          ) : (
            projects.slice(0, 5).map((project: Project) => (
              <ProjectCard
                key={project.id}
                id={project.id}
                topic={project.topic}
                status={project.status}
                viralScore={project.viralScore}
                views={project.analytics?.views}
                createdAt={project.createdAt}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
