'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/store';

export default function AIControlPage() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [topicInput, setTopicInput] = useState('');

  const { data: statusData, isLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['ai-control-status'],
    queryFn: async () => {
      const res = await apiClient('/api/ai-control/status');
      if (!res.success) throw new Error('Failed to load status');
      return res;
    },
    refetchInterval: 15000,
  });

  const { data: errorsData, refetch: refetchErrors } = useQuery({
    queryKey: ['ai-control-errors'],
    queryFn: async () => {
      const res = await apiClient('/api/ai-control/errors');
      if (!res.success) throw new Error('Failed to load errors');
      return res;
    },
    refetchInterval: 10000,
  });

  const { data: viralData } = useQuery({
    queryKey: ['ai-control-viral'],
    queryFn: async () => {
      const res = await apiClient('/api/ai-control/viral-opportunities');
      return res;
    },
  });

  const { data: patternsData } = useQuery({
    queryKey: ['ai-control-patterns'],
    queryFn: async () => {
      const res = await apiClient('/api/ai-control/winning-patterns');
      return res;
    },
  });

  const { data: channelsData } = useQuery({
    queryKey: ['ai-control-channels'],
    queryFn: async () => {
      const res = await apiClient('/api/ai-control/channel-metrics');
      return res;
    },
  });

  const startMutation = useMutation({
    mutationFn: () => apiClient('/api/ai-control/automation/start', { method: 'POST' }),
    onSuccess: () => refetchStatus(),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiClient('/api/ai-control/automation/stop', { method: 'POST' }),
    onSuccess: () => refetchStatus(),
  });

  const fixAllMutation = useMutation({
    mutationFn: () => apiClient('/api/ai-control/errors/fix-all', { method: 'POST' }),
    onSuccess: () => refetchErrors(),
  });

  const generateMutation = useMutation({
    mutationFn: (topic: string) => apiClient('/api/ai-control/generate-video', {
      method: 'POST',
      body: JSON.stringify({ topic }),
    }),
    onSuccess: () => { setTopicInput(''); },
  });

  const health = statusData?.health;
  const queues = statusData?.queues || [];
  const errors = statusData?.errors;
  const isAutomationActive = statusData?.automation?.active;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'errors', label: 'AI Debugger', icon: '🔧' },
    { id: 'viral', label: 'Viral Intel', icon: '🔥' },
    { id: 'generate', label: 'Generate', icon: '🎬' },
    { id: 'patterns', label: 'Winning Patterns', icon: '🏆' },
    { id: 'channels', label: 'Channels', icon: '📺' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">AI Control Center</h1>
          <p className="text-muted mt-1">Autonomous system command and control</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${isAutomationActive ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            <span className={`w-2 h-2 rounded-full ${isAutomationActive ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {isAutomationActive ? 'Running' : 'Stopped'}
          </div>
          {isAutomationActive ? (
            <button onClick={() => stopMutation.mutate()} className="btn-secondary text-sm">
              Stop Automation
            </button>
          ) : (
            <button onClick={() => startMutation.mutate()} className="btn-primary text-sm">
              Start Automation
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === t.id ? 'bg-primary text-white' : 'bg-card border border-card-border text-muted hover:text-foreground'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glow-card rounded-xl p-5">
              <p className="text-sm text-muted">System Status</p>
              <p className={`text-2xl font-bold ${health?.status === 'healthy' ? 'text-green-400' : health?.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'}`}>
                {health?.status || 'unknown'}
              </p>
            </div>
            <div className="glow-card rounded-xl p-5">
              <p className="text-sm text-muted">Active Jobs</p>
              <p className="text-2xl font-bold">{queues.reduce((s: number, q: any) => s + q.active, 0)}</p>
            </div>
            <div className="glow-card rounded-xl p-5">
              <p className="text-sm text-muted">Queue Size</p>
              <p className="text-2xl font-bold">{queues.reduce((s: number, q: any) => s + q.waiting, 0)}</p>
            </div>
            <div className="glow-card rounded-xl p-5">
              <p className="text-sm text-muted">Errors Captured</p>
              <p className="text-2xl font-bold text-red-400">{errors?.summary?.total || 0}</p>
            </div>
          </div>

          <div className="glow-card rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Queue Status</h2>
            <div className="space-y-3">
              {queues.map((q: any) => (
                <div key={q.name} className="flex items-center justify-between p-3 bg-black/20 rounded-xl">
                  <span className="text-sm font-medium">{q.name}</span>
                  <div className="flex gap-4 text-xs text-muted">
                    <span className={q.waiting > 0 ? 'text-yellow-400' : ''}>Waiting: {q.waiting}</span>
                    <span className={q.active > 0 ? 'text-blue-400' : ''}>Active: {q.active}</span>
                    <span className="text-green-400">Done: {q.completed}</span>
                    <span className={q.failed > 0 ? 'text-red-400' : ''}>Failed: {q.failed}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === 'errors' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">AI Error Fixer Engine</h2>
            <button onClick={() => fixAllMutation.mutate()} className="btn-primary text-sm">
              Fix All Errors
            </button>
          </div>
          {errors?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Object.entries(errors.summary).filter(([k]) => k !== 'total' && k !== 'byType').map(([key, val]) => (
                <div key={key} className="glow-card rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${key === 'critical' ? 'text-red-400' : key === 'high' ? 'text-orange-400' : key === 'medium' ? 'text-yellow-400' : 'text-muted'}`}>{val as number}</p>
                  <p className="text-xs text-muted capitalize">{key}</p>
                </div>
              ))}
            </div>
          )}
          <div className="glow-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border">
                    <th className="text-left p-4 text-muted font-medium">Time</th>
                    <th className="text-left p-4 text-muted font-medium">Type</th>
                    <th className="text-left p-4 text-muted font-medium">Severity</th>
                    <th className="text-left p-4 text-muted font-medium">Message</th>
                    <th className="text-left p-4 text-muted font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(errorsData?.errors || errors?.recent || []).map((err: any) => (
                    <tr key={err.id} className="border-b border-card-border/50 hover:bg-card-border/20">
                      <td className="p-4 text-muted">{new Date(err.timestamp).toLocaleTimeString()}</td>
                      <td className="p-4"><span className="text-xs px-2 py-1 rounded-full bg-card-border">{err.type}</span></td>
                      <td className="p-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${err.severity === 'critical' ? 'bg-red-500/10 text-red-400' : err.severity === 'high' ? 'bg-orange-500/10 text-orange-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                          {err.severity}
                        </span>
                      </td>
                      <td className="p-4 max-w-xs truncate">{err.message}</td>
                      <td className="p-4">
                        <button onClick={async () => {
                          await apiClient(`/api/ai-control/errors/fix/${err.id}`, { method: 'POST' });
                          refetchErrors();
                        }} className="text-xs text-primary hover:underline">
                          Auto-Fix
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!errorsData?.errors?.length && !errors?.recent?.length) && (
                    <tr><td colSpan={5} className="p-8 text-center text-muted">No errors captured</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'viral' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Viral Opportunities</h2>
          <div className="glow-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border">
                    <th className="text-left p-4 text-muted font-medium">Topic</th>
                    <th className="text-left p-4 text-muted font-medium">Viral Score</th>
                    <th className="text-left p-4 text-muted font-medium">Competition</th>
                    <th className="text-left p-4 text-muted font-medium">Source</th>
                    <th className="text-left p-4 text-muted font-medium">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {(viralData?.opportunities || []).map((opp: any) => (
                    <tr key={opp.id} className="border-b border-card-border/50 hover:bg-card-border/20">
                      <td className="p-4 font-medium">{opp.topic}</td>
                      <td className="p-4">
                        <span className={`text-sm font-bold ${opp.viralScore >= 80 ? 'text-green-400' : opp.viralScore >= 60 ? 'text-yellow-400' : 'text-muted'}`}>
                          {opp.viralScore?.toFixed(0) || 'N/A'}
                        </span>
                      </td>
                      <td className="p-4">{opp.competition ? `${opp.competition.toFixed(0)}%` : 'N/A'}</td>
                      <td className="p-4 text-muted">{opp.source || 'N/A'}</td>
                      <td className="p-4 text-muted">{new Date(opp.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {(!viralData?.opportunities?.length) && (
                    <tr><td colSpan={5} className="p-8 text-center text-muted">No viral opportunities yet. Run trend analysis first.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'generate' && (
        <div className="space-y-6">
          <div className="glow-card rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Generate Video Now</h2>
            <div className="flex gap-3">
              <input className="input-field flex-1" value={topicInput} onChange={e => setTopicInput(e.target.value)} placeholder="Enter a topic for AI video generation..." />
              <button onClick={() => generateMutation.mutate(topicInput)} disabled={!topicInput || generateMutation.isPending} className="btn-primary">
                {generateMutation.isPending ? 'Generating...' : 'Generate'}
              </button>
            </div>
            {generateMutation.data?.projectId && (
              <p className="text-sm text-green-400 mt-3">Video queued! Project ID: {generateMutation.data.projectId}</p>
            )}
          </div>

          <div className="glow-card rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button onClick={() => apiClient('/api/trends/analyze', { method: 'POST' })} className="p-4 rounded-xl bg-card border border-card-border hover:border-primary/30 text-left transition-all">
                <span className="text-2xl">🔍</span>
                <p className="text-sm font-medium mt-2">Scan Trends</p>
              </button>
              <button onClick={() => apiClient('/api/godmode/scan', { method: 'POST' })} className="p-4 rounded-xl bg-card border border-card-border hover:border-primary/30 text-left transition-all">
                <span className="text-2xl">🧠</span>
                <p className="text-sm font-medium mt-2">Godmode Scan</p>
              </button>
              <button onClick={() => setActiveTab('patterns')} className="p-4 rounded-xl bg-card border border-card-border hover:border-primary/30 text-left transition-all">
                <span className="text-2xl">🏆</span>
                <p className="text-sm font-medium mt-2">View Patterns</p>
              </button>
              <button onClick={() => setActiveTab('errors')} className="p-4 rounded-xl bg-card border border-card-border hover:border-primary/30 text-left transition-all">
                <span className="text-2xl">🔧</span>
                <p className="text-sm font-medium mt-2">Fix Errors</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'patterns' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Winning Patterns Library</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(patternsData?.patterns || []).map((p: any) => (
              <div key={p.id} className="glow-card rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{p.patternType || 'Pattern'}</h3>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400">{p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : 'N/A'}</span>
                </div>
                <p className="text-sm text-muted mb-3">{p.content || p.description || 'No content'}</p>
                <p className="text-xs text-muted">Source: {p.source || 'AI Discovered'}</p>
              </div>
            ))}
            {(!patternsData?.patterns?.length) && (
              <div className="col-span-2 text-center py-12 text-muted">No patterns extracted yet.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'channels' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Channel Metrics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(channelsData?.channels || []).map((ch: any) => (
              <div key={ch.id} className="glow-card rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  {ch.youtubeAccount?.channelAvatar ? (
                    <img src={ch.youtubeAccount.channelAvatar} className="w-10 h-10 rounded-full" alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-lg">📺</div>
                  )}
                  <div>
                    <p className="font-semibold">{ch.youtubeAccount?.channelTitle || 'Unknown Channel'}</p>
                    <p className="text-xs text-muted">{ch.subscriberCount?.toLocaleString() || 0} subscribers</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted">Views:</span> <span className="font-medium">{ch.totalViews?.toLocaleString() || 0}</span></div>
                  <div><span className="text-muted">Videos:</span> <span className="font-medium">{ch.totalVideos || 0}</span></div>
                </div>
                <p className="text-xs text-muted mt-3">Synced: {ch.lastSyncedAt ? new Date(ch.lastSyncedAt).toLocaleDateString() : 'Never'}</p>
              </div>
            ))}
            {(!channelsData?.channels?.length) && (
              <div className="col-span-3 text-center py-12 text-muted">No channels connected.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
