'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { apiClient } from '@/store';
import toast from 'react-hot-toast';


export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;


  const { data, isLoading, refetch } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient(`/api/videos/status/${projectId}`),
  });

  const project = data?.project;

  const generateScript = useMutation({
    mutationFn: () => apiClient(`/api/scripts/generate/${projectId}`, { method: 'POST' }),
    onSuccess: () => { toast.success('Script generated!'); refetch(); },
    onError: () => toast.error('Script generation failed'),
  });

  const generateVideo = useMutation({
    mutationFn: () => apiClient(`/api/videos/generate/${projectId}`, { method: 'POST' }),
    onSuccess: () => { toast.success('Video pipeline started!'); refetch(); },
    onError: () => toast.error('Video generation failed'),
  });

  const renderVideo = useMutation({
    mutationFn: () => apiClient(`/api/videos/render/${projectId}`, { method: 'POST' }),
    onSuccess: () => { toast.success('Render started!'); refetch(); },
    onError: () => toast.error('Render failed'),
  });

  const uploadVideo = useMutation({
    mutationFn: () => apiClient(`/api/upload/youtube/${projectId}`, { method: 'POST' }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Uploaded!');
        refetch();
      } else {
        toast.error(data.message || 'Upload failed');
      }
    },
    onError: () => toast.error('Upload failed'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-card-border rounded w-64 animate-pulse" />
        <div className="h-40 bg-card-border rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">🔍</p>
        <p className="text-muted">Project not found</p>
      </div>
    );
  }

  const pipelineSteps = [
    { label: 'Trend Analysis', status: project.trendResearch ? 'completed' : 'pending' },
    { label: 'Script Generation', status: project.script ? 'completed' : 'pending' },
    { label: 'Thumbnail', status: project.thumbnail ? 'completed' : 'pending' },
    { label: 'Voiceover', status: project.voiceover ? 'completed' : 'pending' },
    { label: 'Video Render', status: project.videoRender?.status === 'completed' ? 'completed' : project.videoRender ? 'in_progress' : 'pending' },
    { label: 'Published', status: project.uploadHistory ? 'completed' : 'pending' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{project.topic}</h1>
          <p className="text-muted mt-1">Status: {project.status}</p>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-sm border ${
          project.viralScore > 70
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
        }`}>
          Viral Score: {project.viralScore}%
        </span>
      </div>

      <div className="glow-card rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Pipeline Progress</h2>
        <div className="space-y-3">
          {pipelineSteps.map((step) => (
            <div key={step.label} className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                step.status === 'completed' ? 'bg-green-500' :
                step.status === 'in_progress' ? 'bg-primary animate-pulse' :
                'bg-card-border'
              }`} />
              <span className={`text-sm ${
                step.status === 'completed' ? 'text-green-400' :
                step.status === 'in_progress' ? 'text-primary' :
                'text-muted'
              }`}>{step.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={() => generateScript.mutate()} className="btn-secondary"
          disabled={generateScript.isPending || !!project.script}>
          {generateScript.isPending ? '⏳ Generating Script...' : '📝 Generate Script'}
        </button>
        <button onClick={() => generateVideo.mutate()} className="btn-secondary"
          disabled={generateVideo.isPending || !project.script || !!project.videoRender}>
          {generateVideo.isPending ? '⏳ Generating...' : '🎬 Full Pipeline'}
        </button>
        <button onClick={() => renderVideo.mutate()} className="btn-secondary"
          disabled={renderVideo.isPending || !project.script}>
          {renderVideo.isPending ? '⏳ Rendering...' : '🎞️ Render Video'}
        </button>
        <button onClick={() => uploadVideo.mutate()} className="btn-primary"
          disabled={uploadVideo.isPending || !project.videoRender || !!project.uploadHistory}>
          {uploadVideo.isPending ? '⏳ Uploading...' : '📤 Upload to YouTube'}
        </button>
      </div>

      {project.script && (
        <div className="glow-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3">Script</h2>
          <p className="text-sm text-muted whitespace-pre-wrap line-clamp-10">{project.script.content}</p>
        </div>
      )}

      {project.uploadHistory && (
        <div className="glow-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3">Published</h2>
          <p className="text-sm text-muted">
            Video ID: {project.uploadHistory.videoId}
          </p>
          {project.uploadHistory.videoId && (
            <a
              href={`https://youtube.com/watch?v=${project.uploadHistory.videoId}`}
              target="_blank"
              className="text-primary hover:underline text-sm mt-2 inline-block"
            >
              Watch on YouTube →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
