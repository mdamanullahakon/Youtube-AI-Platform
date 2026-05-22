'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StatCard } from '@/components/StatCard';
import { ActivityChart } from '@/components/ActivityChart';
import { apiClient } from '@/store';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';

export default function AnalyticsPage() {
  const [tab, setTab] = useState<'overview' | 'retention' | 'ctr' | 'monetization' | 'patterns'>('overview');

  const { data: statsData, isLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => {
      const res = await apiClient('/api/analytics/dashboard');
      if (!res.success) throw new Error(res.message || 'Failed to load analytics');
      return res;
    },
    retry: 1, staleTime: 60000,
  });

  const { data: ctrData } = useQuery({
    queryKey: ['ctr-analysis'],
    queryFn: async () => {
      const res = await apiClient('/api/analytics-learning/thumbnails/analysis');
      return res.success ? res : { data: [] };
    },
    retry: 1, staleTime: 120000, enabled: tab === 'ctr',
  });

  const { data: globalReport } = useQuery({
    queryKey: ['global-report'],
    queryFn: async () => {
      const res = await apiClient('/api/analytics-learning/global-report');
      return res.success ? res : { report: null };
    },
    retry: 1, staleTime: 120000, enabled: tab === 'retention',
  });

  const { data: patterns } = useQuery({
    queryKey: ['winning-patterns'],
    queryFn: async () => {
      const res = await apiClient('/api/business/patterns');
      return res.success ? res : { patterns: [] };
    },
    retry: 1, staleTime: 120000, enabled: tab === 'patterns',
  });

  const { data: monetization } = useQuery({
    queryKey: ['monetization'],
    queryFn: async () => {
      const res = await apiClient('/api/business/monetization');
      return res.success ? res : { report: null };
    },
    retry: 1, staleTime: 120000, enabled: tab === 'monetization',
  });

  const stats = statsData?.stats;
  const chartData = stats?.weeklyViews as { name: string; views: number; likes: number }[] | undefined;
  const report = globalReport?.report;
  const ctrAnalysis = ctrData?.analysis || ctrData?.data || [];
  const patternsData = patterns?.patterns || [];
  const monetizationReport = monetization?.report;

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: '📊' },
    { key: 'retention' as const, label: 'Retention', icon: '📉' },
    { key: 'ctr' as const, label: 'CTR Analysis', icon: '🎯' },
    { key: 'patterns' as const, label: 'Winning Patterns', icon: '🏆' },
    { key: 'monetization' as const, label: 'Monetization', icon: '💰' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Growth Analytics</h1>
        <p className="text-muted mt-1">Performance metrics, insights, and monetization tracking</p>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-card-border pb-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-all ${tab === t.key ? 'bg-primary/10 text-primary border border-primary/20' : 'text-muted hover:text-foreground'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Views" value={stats?.totalViews || 0} icon="👁️" loading={isLoading} />
            <StatCard title="Total Likes" value={stats?.totalLikes || 0} icon="❤️" loading={isLoading} />
            <StatCard title="Comments" value={stats?.totalComments || 0} icon="💬" loading={isLoading} />
            <StatCard title="Subscribers" value={stats?.subscribersGained || 0} icon="📈" loading={isLoading} />
            <StatCard title="Total Projects" value={stats?.totalProjects || 0} icon="🎬" loading={isLoading} />
            <StatCard title="Total Uploads" value={stats?.totalUploads || 0} icon="📤" loading={isLoading} />
            <StatCard title="Avg CTR" value={stats?.averageCTR ? `${stats.averageCTR.toFixed(1)}%` : 'N/A'} icon="🎯" loading={isLoading} />
            <StatCard title="Avg Retention" value={stats?.averageRetention ? `${stats.averageRetention.toFixed(1)}%` : 'N/A'} icon="📉" loading={isLoading} />
          </div>
          <ActivityChart data={chartData} />
        </>
      )}

      {tab === 'retention' && (
        <div className="space-y-4">
          {report?.topHookTypes?.length > 0 && (
            <div className="glow-card rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Best Performing Hook Types</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.topHookTypes.map((h: { type?: string; hookType?: string; avgRetention?: number; averageRetention?: number }) => ({ name: h.type || h.hookType, retention: h.avgRetention || h.averageRetention || 0 }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a24" />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={11} />
                    <YAxis stroke="#71717a" fontSize={12} unit="%" />
                    <Tooltip contentStyle={{ background: '#111118', border: '1px solid #1a1a24', borderRadius: '8px', color: '#ededed' }} />
                    <Bar dataKey="retention" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {report?.topThumbnailStyles?.length > 0 && (
            <div className="glow-card rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Best Thumbnail Styles by CTR</h3>
              <div className="space-y-3">
                {report.topThumbnailStyles.map((s: { style?: string; thumbnailStyle?: string; ctr?: number; averageCTR?: number }, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-card-border/30 rounded-lg">
                    <span className="text-sm">{s.style || s.thumbnailStyle}</span>
                    <span className="text-sm font-medium text-primary">{s.ctr || s.averageCTR?.toFixed(1)}% CTR</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {report?.recommendations?.length > 0 && (
            <div className="glow-card rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Optimization Recommendations</h3>
              <div className="space-y-2">
                {report.recommendations.slice(0, 5).map((r: { priority?: string; content?: string; recommendation?: string }, i: number) => (
                  <div key={i} className="p-3 bg-card-border/30 rounded-lg text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                      r.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                      r.priority === 'high' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>{r.priority || 'medium'}</span>
                    {r.content || r.recommendation}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!report && <div className="glow-card rounded-xl p-6 text-sm text-muted">Publish more videos to see retention analysis and optimization recommendations.</div>}
        </div>
      )}

      {tab === 'ctr' && (
        <div className="space-y-4">
          {Array.isArray(ctrAnalysis) && ctrAnalysis.length > 0 ? (
            <div className="glow-card rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Thumbnail Style Performance</h3>
              <div className="space-y-3">
                {ctrAnalysis.map((item: { style?: string; thumbnailStyle?: string; ctr?: number; predictedCTR?: number; impressions?: number; clicks?: number; performance?: string }, i: number) => (
                  <div key={i} className="p-4 bg-card-border/30 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium">{item.style || item.thumbnailStyle || `Style ${i + 1}`}</span>
                      <span className="text-primary font-bold">{item.ctr || item.predictedCTR || 0}% CTR</span>
                    </div>
                    {(item.impressions ?? 0) > 0 && <p className="text-xs text-muted">{item.impressions} impressions, {item.clicks} clicks</p>}
                    {item.performance && <p className={`text-xs mt-1 ${item.performance === 'excellent' ? 'text-green-400' : item.performance === 'good' ? 'text-blue-400' : 'text-yellow-400'}`}>{item.performance}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="glow-card rounded-xl p-6 text-sm text-muted">Upload videos with thumbnails to see CTR analysis by style.</div>
          )}
        </div>
      )}

      {tab === 'patterns' && (
        <div className="space-y-4">
          {patternsData.length > 0 ? (
            <div className="grid gap-4">
              {patternsData.map((p: { category?: string; type?: string; confidence?: number; score?: number; content?: string; pattern?: string; description?: string; sampleSize?: number }, i: number) => (
                <div key={i} className="glow-card rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium capitalize">{p.category || p.type || 'Pattern'}</span>
                    <span className="text-xs text-muted">Confidence: {p.confidence || p.score || 0}%</span>
                  </div>
                  <p className="text-sm text-muted">{p.content || p.pattern || p.description}</p>
                  {p.sampleSize && <p className="text-xs text-muted mt-1">Sample: {p.sampleSize} videos</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="glow-card rounded-xl p-6 text-sm text-muted">Extract winning patterns from successful videos to see them here. Use the Business API to extract patterns from transcripts.</div>
          )}
        </div>
      )}

      {tab === 'monetization' && (
        <div className="space-y-4">
          {monetizationReport ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard title="Est. RPM" value={monetizationReport.rpm ? `$${monetizationReport.rpm.toFixed(2)}` : 'N/A'} icon="💰" />
                <StatCard title="Est. Earnings" value={monetizationReport.estimatedEarnings ? `$${monetizationReport.estimatedEarnings.toFixed(2)}` : '$0'} icon="💵" />
                <StatCard title="Growth Velocity" value={monetizationReport.growthVelocity || 'N/A'} icon="📈" />
              </div>
              {monetizationReport.projection && (
                <div className="glow-card rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Revenue Projections</h3>
                  <div className="space-y-2">
                    {Object.entries(monetizationReport.projection).map(([period, amount]) => (
                      <div key={period} className="flex justify-between p-2 bg-card-border/30 rounded">
                        <span className="text-sm capitalize">{period}</span>
                        <span className="text-sm font-medium text-primary">${typeof amount === 'number' ? amount.toFixed(2) : String(amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="glow-card rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">Monetization Setup</h3>
                <div className="space-y-3 text-sm">
                  <p className="text-muted">To start earning revenue:</p>
                  <ol className="list-decimal list-inside space-y-2 text-muted">
                    <li>Publish consistently (aim for 1 video/day minimum)</li>
                    <li>Build to 1,000 subscribers + 4,000 watch hours</li>
                    <li>Apply for YouTube Partner Program</li>
                    <li>Enable ads on all content</li>
                    <li>Add affiliate links in descriptions</li>
                  </ol>
                </div>
              </div>
              <div className="glow-card rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">First $100 Strategy</h3>
                <div className="space-y-2 text-sm text-muted">
                  <p>• Publish 30 videos in high-RPM niches (finance, tech, business)</p>
                  <p>• Optimize titles for search (not just trends)</p>
                  <p>• Add 2-3 affiliate links per video description</p>
                  <p>• Cross-promote videos in end screens</p>
                  <p>• Post 1 Short per day for subscriber growth</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
