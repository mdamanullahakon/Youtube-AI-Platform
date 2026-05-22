'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/store';

interface ViralOpportunity {
  id: string;
  topic: string;
  viralScore: number;
  ctrScore?: number;
  retentionScore?: number;
  competition?: number;
  monetizationScore?: number;
  source?: string;
}

interface WinningPattern {
  id: string;
  patternType?: string;
  confidence?: number;
  content?: string;
  description?: string;
  source?: string;
}

export default function ViralOpportunitiesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['viral-opportunities'],
    queryFn: async () => {
      const res = await apiClient('/api/ai-control/viral-opportunities');
      if (!res.success) throw new Error('Failed to load');
      return res;
    },
    refetchInterval: 30000,
  });

  const { data: patternsData } = useQuery({
    queryKey: ['winning-patterns'],
    queryFn: async () => {
      const res = await apiClient('/api/ai-control/winning-patterns');
      return res;
    },
  });

  const opportunities = data?.opportunities || [];
  const patterns = patternsData?.patterns || [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">🔥 Viral Intelligence</h1>
          <p className="text-muted mt-1">AI-powered viral content discovery engine</p>
        </div>
        <button
          onClick={async () => {
            await apiClient('/api/business/viral/scan', { method: 'POST' });
          }}
          className="btn-primary text-sm"
        >
          Scan Now
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <div className="glow-card rounded-xl overflow-hidden">
            <div className="p-5 border-b border-card-border">
              <h2 className="text-lg font-semibold">Viral Opportunities ({opportunities.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border">
                    <th className="text-left p-4 text-muted font-medium">Topic</th>
                    <th className="text-left p-4 text-muted font-medium">Viral Score</th>
                    <th className="text-left p-4 text-muted font-medium">CTR</th>
                    <th className="text-left p-4 text-muted font-medium">Retention</th>
                    <th className="text-left p-4 text-muted font-medium">Competition</th>
                    <th className="text-left p-4 text-muted font-medium">Monetization</th>
                    <th className="text-left p-4 text-muted font-medium">Source</th>
                    <th className="text-left p-4 text-muted font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((opp: ViralOpportunity) => (
                    <tr key={opp.id} className="border-b border-card-border/50 hover:bg-card-border/20">
                      <td className="p-4 font-medium max-w-xs truncate">{opp.topic}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 rounded-full bg-card-border overflow-hidden">
                            <div className={`h-full rounded-full ${opp.viralScore >= 80 ? 'bg-green-400' : opp.viralScore >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
                              style={{ width: `${Math.min(opp.viralScore || 0, 100)}%` }} />
                          </div>
                          <span className="text-xs">{opp.viralScore?.toFixed(0) || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="p-4 text-muted">{opp.ctrScore ? `${opp.ctrScore.toFixed(0)}%` : 'N/A'}</td>
                      <td className="p-4 text-muted">{opp.retentionScore ? `${opp.retentionScore.toFixed(0)}%` : 'N/A'}</td>
                      <td className="p-4 text-muted">{opp.competition ? `${opp.competition.toFixed(0)}%` : 'N/A'}</td>
                      <td className="p-4 text-muted">{opp.monetizationScore ? `${opp.monetizationScore.toFixed(0)}%` : 'N/A'}</td>
                      <td className="p-4">
                        <span className="text-xs px-2 py-1 rounded-full bg-card-border">{opp.source || 'AI'}</span>
                      </td>
                      <td className="p-4">
                        <button className="text-xs text-primary hover:underline">Generate Video</button>
                      </td>
                    </tr>
                  ))}
                  {opportunities.length === 0 && (
                    <tr><td colSpan={8} className="p-8 text-center text-muted">No opportunities found. Click &quot;Scan Now&quot; to discover viral topics.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glow-card rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Winning Patterns Library</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">                  {patterns.map((p: WinningPattern) => (
                <div key={p.id} className="bg-black/20 rounded-xl p-4 border border-card-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary">{p.patternType || 'Pattern'}</span>
                    {p.confidence && (
                      <span className="text-xs text-muted">{(p.confidence * 100).toFixed(0)}% confidence</span>
                    )}
                  </div>
                  <p className="text-sm">{p.content || p.description}</p>
                  {p.source && <p className="text-xs text-muted mt-2">Source: {p.source}</p>}
                </div>
              ))}
              {patterns.length === 0 && (
                <div className="col-span-2 text-center py-8 text-muted">No patterns extracted. Process transcripts to discover winning patterns.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
