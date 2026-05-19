'use client';

import Link from 'next/link';

interface ProjectCardProps {
  id: string;
  topic: string;
  status: string;
  viralScore: number;
  views?: number;
  createdAt: string;
}

export function ProjectCard({ id, topic, status, viralScore, views, createdAt }: ProjectCardProps) {
  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    trending_analyzed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    script_generated: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    video_ready: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    rendered: 'bg-green-500/10 text-green-400 border-green-500/20',
    published: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  };

  return (
    <Link href={`/dashboard/projects/${id}`}>
      <div className="glow-card rounded-xl p-5 animate-in cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold line-clamp-1 flex-1">{topic}</h3>
          <span className={`text-xs px-2.5 py-1 rounded-full border ml-2 whitespace-nowrap ${statusColors[status] || statusColors.draft}`}>
            {status.replace('_', ' ')}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>Score: {viralScore}%</span>
          {views !== undefined && <span>Views: {views.toLocaleString()}</span>}
          <span className="ml-auto">{new Date(createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    </Link>
  );
}
