'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/store';
import toast from 'react-hot-toast';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';

import {
  ScoreGauge,
  InfoRow,
  ChipList,
  AnimatedScoreBar,
  TabBar,
  PipelineStepper,
  getHealthStatus,
  getMode,
  getScoreColor,
  type PipelineStep,
} from '@/components/audit-components';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AuditReport {
  niche_analysis: {
    actualNiche: string;
    expectedNiche: string;
    matchScore: number;
    mismatchReasons: string[];
    nicheClarityLevel: 'Clear' | 'Confused' | 'Mixed';
  };
  branding: {
    brandingScore: number;
    issues: string[];
    emotionalImpactLevel: 'Low' | 'Medium' | 'High';
  };
  seo: {
    seoScore: number;
    missingKeywords: string[];
    keywordOpportunities: string[];
  };
  content_strategy: {
    contentStrategyScore: number;
    viralPotentialRating: string;
    contentGaps: string[];
  };
  ctr_retention: {
    ctrScore: number;
    retentionScore: number;
    keyDropOffRisks: string[];
  };
  competitor_analysis: {
    weaknessVsCompetitors: string[];
    opportunitiesToOutperform: string[];
  };
  action_plan: {
    quick_fixes: string[];
    high_impact_fixes: string[];
    long_term_strategy: string[];
    suggestedDescription: string;
    suggestedTags: string[];
    suggestedChannelName: string;
    bannerTextSuggestion: string;
    logoConceptSuggestion: string;
  };
  final_score: number;
  summary: string;
}

interface OptimizationOutput {
  niche_positioning: string;
  optimized_description: string;
  optimized_tags: string[];
  name_suggestions: string[];
  banner_text: { headline: string; subheadline: string };
  logo_concept: string;
  viral_video_ideas: string[];
  seo_boost: { keywordsToTarget: string[]; hashtagStrategy: string };
  monetization_plan: string;
  transformation_summary: string;
  confidence_score: number;
  before_vs_after: {
    whatWasWrong: string[];
    whatIsFixed: string[];
    expectedImprovement: string;
  };
}

interface Channel {
  id: string;
  channelId: string;
  channelTitle: string | null;
  channelAvatar: string | null;
  isConnected: boolean;
}

type ResultTab = 'audit-results' | 'optimization' | 'comparison';

// ─── Theme Colors ───────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  niche: '#8b5cf6',
  branding: '#06b6d4',
  seo: '#f59e0b',
  content: '#10b981',
  ctr: '#f43f5e',
  retention: '#3b82f6',
  competitor: '#ec4899',
} as const;

const RADAR_DATA_KEYS = [
  { key: 'niche', label: 'Niche Alignment', color: CATEGORY_COLORS.niche, getValue: (r: AuditReport) => r.niche_analysis.matchScore },
  { key: 'branding', label: 'Branding', color: CATEGORY_COLORS.branding, getValue: (r: AuditReport) => r.branding.brandingScore },
  { key: 'seo', label: 'SEO', color: CATEGORY_COLORS.seo, getValue: (r: AuditReport) => r.seo.seoScore },
  { key: 'content', label: 'Content Strategy', color: CATEGORY_COLORS.content, getValue: (r: AuditReport) => r.content_strategy.contentStrategyScore },
  { key: 'ctr', label: 'CTR', color: CATEGORY_COLORS.ctr, getValue: (r: AuditReport) => r.ctr_retention.ctrScore },
  { key: 'retention', label: 'Retention', color: CATEGORY_COLORS.retention, getValue: (r: AuditReport) => r.ctr_retention.retentionScore },
] as const;

const tooltipStyle = {
  background: '#111118',
  border: '1px solid #1a1a24',
  borderRadius: '8px',
  color: '#ededed',
  fontSize: '12px',
};

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [step, setStep] = useState<PipelineStep>('select');
  const [resultTab, setResultTab] = useState<ResultTab>('audit-results');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [expectedNiche, setExpectedNiche] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelTags, setChannelTags] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [optimization, setOptimization] = useState<OptimizationOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch connected YouTube channels
  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ['youtube-channels'],
    queryFn: async () => {
      const res = await apiClient('/api/youtube/channels');
      if (!res.success) throw new Error(res.message || 'Failed to load channels');
      return res.data?.channels || res.data || [];
    },
    staleTime: 30000,
  });

  const channels: Channel[] = Array.isArray(channelsData) ? channelsData : [];

  // Derive radar chart data from audit report
  const radarData = useMemo(() => {
    if (!auditReport) return [];
    return RADAR_DATA_KEYS.map(d => ({
      category: d.label,
      score: d.getValue(auditReport),
      fillColor: d.color,
    }));
  }, [auditReport]);

  // Derive before/after comparison data
  const comparisonData = useMemo(() => {
    if (!auditReport) return [];
    return [
      { category: 'Niche', before: auditReport.niche_analysis.matchScore, after: Math.min(100, auditReport.niche_analysis.matchScore + 35) },
      { category: 'Branding', before: auditReport.branding.brandingScore, after: Math.min(100, auditReport.branding.brandingScore + 40) },
      { category: 'SEO', before: auditReport.seo.seoScore, after: Math.min(100, auditReport.seo.seoScore + 30) },
      { category: 'Content', before: auditReport.content_strategy.contentStrategyScore, after: Math.min(100, auditReport.content_strategy.contentStrategyScore + 25) },
      { category: 'CTR', before: auditReport.ctr_retention.ctrScore, after: Math.min(100, auditReport.ctr_retention.ctrScore + 28) },
      { category: 'Retention', before: auditReport.ctr_retention.retentionScore, after: Math.min(100, auditReport.ctr_retention.retentionScore + 22) },
    ];
  }, [auditReport]);

  // Derive radar data for comparison (before + after values for each category)
  const comparisonRadarData = useMemo(() => {
    if (!auditReport) return [];
    return RADAR_DATA_KEYS.map(d => ({
      category: d.label,
      before: d.getValue(auditReport),
      after: Math.min(100, d.getValue(auditReport) + 30),
    }));
  }, [auditReport]);

  // Run audit
  const runAudit = useCallback(async () => {
    if (!selectedChannelId) {
      toast.error('Select a YouTube channel first');
      return;
    }
    setAuditLoading(true);
    setError(null);
    setAuditReport(null);
    setOptimization(null);
    setStep('audit');

    try {
      const body: Record<string, any> = { channelId: selectedChannelId };
      if (expectedNiche.trim()) body.expectedNiche = expectedNiche.trim();
      if (channelDescription.trim()) body.channelDescription = channelDescription.trim();
      if (channelTags.trim()) body.channelTags = channelTags.trim();

      const res = await apiClient('/api/audit/channel', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res.success) {
        throw new Error(res.message || 'Audit failed');
      }

      const report: AuditReport = res.data || res.report || res;
      setAuditReport(report);
      setResultTab('audit-results');
      setStep('result');
      toast.success('Channel audit complete!');
    } catch (err: any) {
      const msg = err?.message || 'Failed to run audit';
      setError(msg);
      toast.error(msg);
      setStep('select');
    } finally {
      setAuditLoading(false);
    }
  }, [selectedChannelId, expectedNiche, channelDescription, channelTags]);

  // Run optimization
  const runOptimization = useCallback(async () => {
    if (!auditReport) return;
    setOptimizeLoading(true);
    setError(null);

    const selectedChannel = channels.find(c => c.channelId === selectedChannelId || c.id === selectedChannelId);

    try {
      const body = {
        auditReport,
        channelName: selectedChannel?.channelTitle || 'My Channel',
        channelDescription: channelDescription || '',
        channelTags: channelTags || expectedNiche || '',
        channelBanner: '',
        channelLogo: selectedChannel?.channelAvatar || '',
        targetNiche: expectedNiche || 'General',
        targetAudience: '',
      };

      const res = await apiClient('/api/audit/optimize', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res.success) {
        throw new Error(res.message || 'Optimization failed');
      }

      const opt: OptimizationOutput = res.data || res.optimization || res;
      setOptimization(opt);
      setResultTab('optimization');
      setStep('optimize');
      toast.success('Channel optimization complete!');
    } catch (err: any) {
      const msg = err?.message || 'Failed to optimize';
      setError(msg);
      toast.error(msg);
    } finally {
      setOptimizeLoading(false);
    }
  }, [auditReport, channels, selectedChannelId, channelDescription, channelTags, expectedNiche]);

  // Selected channel for display
  const selectedChannel = channels.find(c => c.channelId === selectedChannelId || c.id === selectedChannelId);

  const resetAudit = () => {
    setStep('select');
    setAuditReport(null);
    setOptimization(null);
    setError(null);
    setResultTab('audit-results');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Channel Audit &amp; Optimize</h1>
          <p className="text-muted mt-1">Deep AI-powered analysis and one-click optimization for your YouTube channel</p>
        </div>
        {auditReport && (
          <button onClick={resetAudit} className="btn-secondary text-sm flex items-center gap-1.5">
            <span>🔄</span> New Audit
          </button>
        )}
      </div>

      {/* Pipeline progress stepper */}
      {(step === 'result' || step === 'optimize' || step === 'audit') && (
        <PipelineStepper currentStep={step === 'optimize' ? 'optimize' : step === 'result' ? 'result' : 'audit'} />
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded-xl p-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 animate-in">
          <span className="font-semibold">Error:</span> {error}
        </div>
      )}

      {/* ── Step: Select Channel ─────────────────────────────────────────── */}
      {step === 'select' && (
        <div className="max-w-2xl mx-auto animate-in">
          <div className="glow-card rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-lg">🎯</div>
              <div>
                <h2 className="text-lg font-semibold">Select YouTube Channel</h2>
                <p className="text-xs text-muted">Choose a channel to analyze and optimize</p>
              </div>
            </div>

            {channelsLoading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2].map(i => <div key={i} className="h-14 bg-card-border rounded-xl" />)}
              </div>
            ) : channels.length === 0 ? (
              <div className="text-center py-10 text-muted">
                <p className="text-4xl mb-3">📺</p>
                <p className="font-medium">No YouTube channels connected</p>
                <p className="text-sm mt-1">Connect a YouTube account in Settings first.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {channels.filter(c => c.isConnected).map(ch => (
                  <button key={ch.id}
                    onClick={() => setSelectedChannelId(ch.channelId)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      selectedChannelId === ch.channelId
                        ? 'border-primary bg-primary/10 shadow-sm shadow-primary/10'
                        : 'border-card-border hover:border-primary/30 hover:bg-card-border/30'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold shrink-0 overflow-hidden">
                      {ch.channelAvatar ? (
                        <img src={ch.channelAvatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        ch.channelTitle?.[0] || '?'
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{ch.channelTitle || 'Unnamed Channel'}</p>
                      <p className="text-xs text-muted truncate">{ch.channelId}</p>
                    </div>
                    {selectedChannelId === ch.channelId && (
                      <span className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Optional fields collapsible */}
            <details className="group">
              <summary className="text-sm text-muted cursor-pointer hover:text-foreground transition-colors select-none flex items-center gap-1">
                <span className="transition-transform group-open:rotate-90">▶</span>
                Advanced Options
              </summary>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-muted">Expected Niche</label>
                  <input type="text" value={expectedNiche} onChange={e => setExpectedNiche(e.target.value)}
                    placeholder="e.g. Psychological Horror, Tech Reviews, Gaming"
                    className="input-field" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-muted">Channel Description</label>
                  <textarea value={channelDescription} onChange={e => setChannelDescription(e.target.value)}
                    placeholder="Paste your channel description for better analysis..."
                    rows={3} className="input-field resize-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-muted">Channel Tags</label>
                  <input type="text" value={channelTags} onChange={e => setChannelTags(e.target.value)}
                    placeholder="Comma-separated tags"
                    className="input-field" />
                </div>
              </div>
            </details>

            <button onClick={runAudit} disabled={!selectedChannelId || auditLoading}
              className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3">
              {auditLoading ? (
                <><span className="animate-spin inline-block">🔍</span> Analyzing Channel...</>
              ) : (
                <><span>🔍</span> Run Channel Audit</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Loading Audit ─────────────────────────────────────────── */}
      {step === 'audit' && (
        <div className="glow-card rounded-xl p-12 text-center animate-in">
          <div className="space-y-6 max-w-md mx-auto">
            <div className="text-6xl animate-bounce">🔍</div>
            <h2 className="text-xl font-semibold">Analyzing Your Channel</h2>
            <p className="text-sm text-muted">Running AI-powered deep analysis across 7 layers...</p>
            <div className="w-full bg-card-border rounded-full h-2.5 mt-4 overflow-hidden">
              <div className="bg-gradient-to-r from-primary to-secondary h-full rounded-full animate-pulse"
                style={{ width: '65%', animation: 'shimmer 2s ease-in-out infinite' }} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted mt-4">
              {[
                { label: 'Niche Alignment', done: true },
                { label: 'Channel Branding', done: false },
                { label: 'SEO & Discoverability', done: false },
                { label: 'Content Strategy', done: false },
                { label: 'CTR & Retention', done: false },
                { label: 'Competitor Analysis', done: false },
              ].map((item, i) => (
                <div key={i} className={`p-2.5 rounded-lg transition-all ${
                  item.done ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-card-border/30 border border-transparent'
                }`}>
                  {item.done ? '✅' : '🔲'} {item.label}
                </div>
              ))}
              <div className="p-2.5 rounded-lg bg-card-border/30 border border-transparent col-span-2">
                🔲 Action Plan &amp; Summary
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Results + Optimization ─────────────────────────────────── */}
      {(step === 'result' || step === 'optimize') && auditReport && (
        <>
          {/* Tab navigation for results */}
          <TabBar
            tabs={[
              { key: 'audit-results', label: 'Audit Results', icon: '📊' },
              { key: 'optimization', label: 'Optimization', icon: '✨' },
              { key: 'comparison', label: 'Comparison', icon: '📈' },
            ]}
            active={resultTab}
            onSelect={(key) => setResultTab(key as ResultTab)}
          />

          {/* ────────────── TAB: Audit Results ──────────────────────────── */}
          {resultTab === 'audit-results' && (
            <div className="space-y-6 animate-in">
              {/* Overall Score + Radar Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-2 glow-card rounded-xl p-6 flex flex-col items-center justify-center relative">
                  <ScoreGauge score={auditReport.final_score} label="Overall Score" size="lg" />
                  <div className="mt-1">
                    <span className={`inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border font-medium ${getHealthStatus(auditReport.final_score).color}`}>
                      {getHealthStatus(auditReport.final_score).emoji} {getHealthStatus(auditReport.final_score).label}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-2 text-center">{selectedChannel?.channelTitle || 'Channel'}</p>
                  <div className="mt-3 flex gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${auditReport.niche_analysis.nicheClarityLevel === 'Clear' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-amber-500/30 text-amber-400 bg-amber-500/10'}`}>
                      {auditReport.niche_analysis.nicheClarityLevel} Niche
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-primary/30 text-primary bg-primary/10">
                      {getMode(auditReport.final_score)}
                    </span>
                  </div>
                </div>

                <div className="lg:col-span-3 glow-card rounded-xl p-6">
                  <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Score Breakdown</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                        <PolarGrid stroke="#1a1a24" />
                        <PolarAngleAxis dataKey="category" tick={{ fill: '#71717a', fontSize: 10 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 9 }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [`${value}%`, 'Score']} />
                        <Radar name="Score" dataKey="score" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Executive Summary */}
              <div className="glow-card rounded-xl p-6 space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">📋 Executive Summary</h2>
                <p className="text-sm text-muted leading-relaxed">{auditReport.summary}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="text-center p-3 rounded-lg bg-card-border/30">
                    <p className="text-2xl font-bold text-purple-400">{auditReport.niche_analysis.matchScore}</p>
                    <p className="text-xs text-muted">Niche Match</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-card-border/30">
                    <p className="text-2xl font-bold text-cyan-400">{auditReport.branding.brandingScore}</p>
                    <p className="text-xs text-muted">Branding</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-card-border/30">
                    <p className="text-2xl font-bold text-emerald-400">{auditReport.content_strategy.contentStrategyScore}</p>
                    <p className="text-xs text-muted">Content</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-card-border/30">
                    <p className="text-2xl font-bold text-amber-400">{auditReport.seo.seoScore}</p>
                    <p className="text-xs text-muted">SEO</p>
                  </div>
                </div>
              </div>

              {/* Score bars grid */}
              <div className="glow-card rounded-xl p-6">
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Category Scores</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {RADAR_DATA_KEYS.map(d => (
                    <AnimatedScoreBar key={d.key} label={d.label} score={d.getValue(auditReport)} color={d.color} />
                  ))}
                  <div className="md:col-span-2">
                    <AnimatedScoreBar label="Competitor Edge" score={auditReport.competitor_analysis.weaknessVsCompetitors.length > 0 ? 35 : 60} color={CATEGORY_COLORS.competitor} />
                  </div>
                </div>
              </div>

              {/* Analysis Sections */}
              <div className="space-y-6">
                {/* Niche Analysis */}
                <div className="glow-card rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-xs">🎯</span>
                    Niche Alignment
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <InfoRow label="Actual Niche" value={auditReport.niche_analysis.actualNiche} />
                      <InfoRow label="Expected Niche" value={auditReport.niche_analysis.expectedNiche} />
                      <InfoRow label="Match Score" value={`${auditReport.niche_analysis.matchScore}%`} />
                      <InfoRow label="Clarity Level" value={auditReport.niche_analysis.nicheClarityLevel} />
                    </div>
                    <div>
                      <ChipList items={auditReport.niche_analysis.mismatchReasons} label="Mismatch Reasons" />
                    </div>
                  </div>
                </div>

                {/* Branding */}
                <div className="glow-card rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs">🎨</span>
                    Channel Branding
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <InfoRow label="Branding Score" value={`${auditReport.branding.brandingScore}%`} />
                      <InfoRow label="Emotional Impact" value={auditReport.branding.emotionalImpactLevel} />
                    </div>
                    <div>
                      <ChipList items={auditReport.branding.issues} label="Issues" />
                    </div>
                  </div>
                </div>

                {/* SEO */}
                <div className="glow-card rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center text-xs">🔍</span>
                    SEO &amp; Discoverability
                  </h3>
                  <InfoRow label="SEO Score" value={`${auditReport.seo.seoScore}%`} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                    <ChipList items={auditReport.seo.missingKeywords} label="Missing Keywords" color="amber" />
                    <ChipList items={auditReport.seo.keywordOpportunities} label="Keyword Opportunities" color="emerald" />
                  </div>
                </div>

                {/* Content Strategy */}
                <div className="glow-card rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs">📝</span>
                    Content Strategy
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <InfoRow label="Content Score" value={`${auditReport.content_strategy.contentStrategyScore}%`} />
                      <InfoRow label="Viral Potential" value={auditReport.content_strategy.viralPotentialRating} />
                    </div>
                    <div>
                      <ChipList items={auditReport.content_strategy.contentGaps} label="Content Gaps" />
                    </div>
                  </div>
                </div>

                {/* CTR & Retention */}
                <div className="glow-card rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-rose-500/20 flex items-center justify-center text-xs">📈</span>
                    CTR &amp; Retention
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <InfoRow label="CTR Score" value={`${auditReport.ctr_retention.ctrScore}%`} />
                      <InfoRow label="Retention Score" value={`${auditReport.ctr_retention.retentionScore}%`} />
                    </div>
                    <div>
                      <ChipList items={auditReport.ctr_retention.keyDropOffRisks} label="Drop-off Risks" color="amber" />
                    </div>
                  </div>
                </div>

                {/* Competitor Analysis */}
                {auditReport.competitor_analysis.weaknessVsCompetitors.length > 0 && (
                  <div className="glow-card rounded-xl p-6 space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-pink-500/20 flex items-center justify-center text-xs">🏆</span>
                      Competitor Comparison
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <ChipList items={auditReport.competitor_analysis.weaknessVsCompetitors} label="Weaknesses vs Competitors" color="amber" />
                      <ChipList items={auditReport.competitor_analysis.opportunitiesToOutperform} label="Opportunities" color="emerald" />
                    </div>
                  </div>
                )}

                {/* Action Plan */}
                <div className="glow-card rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs">⚡</span>
                    Actionable Improvement Plan
                  </h3>
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                      <p className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-1.5">
                        <span>🔥</span> Quick Fixes <span className="text-xs text-muted font-normal">(1 hour)</span>
                      </p>
                      <ul className="space-y-1.5">
                        {auditReport.action_plan.quick_fixes.map((item, i) => (
                          <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-red-400 mt-0.5">•</span> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20">
                      <p className="text-sm font-semibold text-yellow-400 mb-2 flex items-center gap-1.5">
                        <span>🔥</span> High Impact Fixes <span className="text-xs text-muted font-normal">(1-2 days)</span>
                      </p>
                      <ul className="space-y-1.5">
                        {auditReport.action_plan.high_impact_fixes.map((item, i) => (
                          <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-yellow-400 mt-0.5">•</span> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20">
                      <p className="text-sm font-semibold text-purple-400 mb-2 flex items-center gap-1.5">
                        <span>🚀</span> Growth Strategy <span className="text-xs text-muted font-normal">(Long-term)</span>
                      </p>
                      <ul className="space-y-1.5">
                        {auditReport.action_plan.long_term_strategy.map((item, i) => (
                          <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-purple-400 mt-0.5">•</span> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Suggested Improvements */}
                <div className="glow-card rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">💡 Suggested Improvements</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {auditReport.action_plan.suggestedDescription && (
                      <div className="p-3 rounded-lg bg-card-border/30">
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Description</p>
                        <p className="text-sm line-clamp-4">{auditReport.action_plan.suggestedDescription}</p>
                      </div>
                    )}
                    {auditReport.action_plan.suggestedTags?.length > 0 && auditReport.action_plan.suggestedTags[0] !== 'N/A' && (
                      <div className="p-3 rounded-lg bg-card-border/30">
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Suggested Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {auditReport.action_plan.suggestedTags.map((tag, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {auditReport.action_plan.suggestedChannelName && auditReport.action_plan.suggestedChannelName !== 'N/A' && (
                      <div className="p-3 rounded-lg bg-card-border/30">
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Suggested Channel Name</p>
                        <p className="text-sm font-medium text-primary">{auditReport.action_plan.suggestedChannelName}</p>
                      </div>
                    )}
                    {auditReport.action_plan.bannerTextSuggestion && auditReport.action_plan.bannerTextSuggestion !== 'N/A' && (
                      <div className="p-3 rounded-lg bg-card-border/30">
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Banner Text</p>
                        <p className="text-sm">{auditReport.action_plan.bannerTextSuggestion}</p>
                      </div>
                    )}
                    {auditReport.action_plan.logoConceptSuggestion && auditReport.action_plan.logoConceptSuggestion !== 'N/A' && (
                      <div className="p-3 rounded-lg bg-card-border/30">
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Logo Concept</p>
                        <p className="text-sm">{auditReport.action_plan.logoConceptSuggestion}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* One-Click Optimize */}
              <div className="glow-card rounded-xl p-6 border-primary/30 bg-gradient-to-r from-primary/5 to-secondary/5 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
                <div className="relative flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span>🚀</span> One-Click Optimization
                    </h3>
                    <p className="text-sm text-muted mt-1">
                      Apply AI-powered optimizations — <span className="text-primary font-medium">{getMode(auditReport.final_score)}</span> mode active
                    </p>
                  </div>
                  <button onClick={runOptimization} disabled={optimizeLoading}
                    className="btn-primary flex items-center gap-2 text-base px-8 py-3 shadow-lg shadow-primary/20">
                    {optimizeLoading ? (
                      <><span className="animate-spin">⚡</span> Optimizing...</>
                    ) : (
                      <><span>✨</span> Optimize Channel</>
                    )}
                  </button>
                </div>
                <div className="mt-4 flex gap-2 flex-wrap relative">
                  <span className={`text-xs px-2 py-1 rounded-full border ${getHealthStatus(auditReport.final_score).color}`}>
                    {getHealthStatus(auditReport.final_score).emoji} Score: {auditReport.final_score}
                  </span>
                  <span className="text-xs px-2 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary font-medium">
                    Mode: {getMode(auditReport.final_score)}
                  </span>
                  {selectedChannel?.channelTitle && (
                    <span className="text-xs px-2 py-1 rounded-full border border-card-border text-muted">
                      📺 {selectedChannel.channelTitle}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ────────────── TAB: Optimization ────────────────────────────── */}
          {resultTab === 'optimization' && (
            <div className="space-y-6 animate-in">
              {step === 'optimize' && optimization ? (
                <>
                  {/* Before / After / Confidence */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="glow-card rounded-xl p-6 text-center">
                      <p className="text-xs text-muted uppercase tracking-wider mb-1">Before Score</p>
                      <p className="text-4xl font-bold text-red-400">{auditReport.final_score}</p>
                      <p className="text-xs text-muted mt-1">{getHealthStatus(auditReport.final_score).emoji} {getHealthStatus(auditReport.final_score).label}</p>
                    </div>
                    <div className="glow-card rounded-xl p-6 text-center border-primary/30 bg-primary/5">
                      <p className="text-xs text-muted uppercase tracking-wider mb-1">Transformation</p>
                      <p className="text-3xl font-bold text-primary mt-2 animate-pulse">→</p>
                      <p className="text-xs font-medium text-primary mt-1">Optimization Applied</p>
                    </div>
                    <div className="glow-card rounded-xl p-6 text-center">
                      <p className="text-xs text-muted uppercase tracking-wider mb-1">AI Confidence</p>
                      <p className="text-4xl font-bold text-emerald-400">{optimization.confidence_score}</p>
                      <p className="text-xs text-muted mt-1">🎯 Confidence Score</p>
                    </div>
                  </div>

                  {/* Transformation Summary */}
                  <div className="glow-card rounded-xl p-6 space-y-3 border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-transparent">
                    <h3 className="text-lg font-semibold flex items-center gap-2">🌟 Transformation Summary</h3>
                    <p className="text-sm text-foreground/80 leading-relaxed">{optimization.transformation_summary}</p>
                  </div>

                  {/* What Was Wrong / What Is Fixed */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="glow-card rounded-xl p-6 space-y-3 border-red-500/20">
                      <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">❌ What Was Wrong</h3>
                      <ul className="space-y-2">
                        {optimization.before_vs_after.whatWasWrong.map((item, i) => (
                          <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-red-400 mt-0.5 shrink-0">•</span> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="glow-card rounded-xl p-6 space-y-3 border-emerald-500/20">
                      <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">✅ What Is Fixed</h3>
                      <ul className="space-y-2">
                        {optimization.before_vs_after.whatIsFixed.map((item, i) => (
                          <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-emerald-400 mt-0.5 shrink-0">•</span> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Expected Improvement */}
                  <div className="glow-card rounded-xl p-6 space-y-3">
                    <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">📊 Expected Improvement</h3>
                    <p className="text-sm text-foreground/80 leading-relaxed">{optimization.before_vs_after.expectedImprovement}</p>
                  </div>

                  {/* Niche Positioning */}
                  <div className="glow-card rounded-xl p-6 space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">🎯 Niche Positioning</h3>
                    <p className="text-sm text-foreground/80 leading-relaxed">{optimization.niche_positioning}</p>
                  </div>

                  {/* Optimized Description */}
                  <div className="glow-card rounded-xl p-6 space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">📝 Optimized Channel Description</h3>
                    <div className="p-4 rounded-xl bg-card-border/30 border border-card-border">
                      <p className="text-sm whitespace-pre-wrap font-mono text-foreground/90 leading-relaxed">
                        {optimization.optimized_description}
                      </p>
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(optimization.optimized_description); toast.success('Description copied!'); }}
                      className="text-xs text-primary hover:underline flex items-center gap-1">
                      📋 Copy to clipboard
                    </button>
                  </div>

                  {/* Optimized Tags */}
                  <div className="glow-card rounded-xl p-6 space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">🏷️ Optimized Tags <span className="text-xs text-muted font-normal">({optimization.optimized_tags.length})</span></h3>
                    <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                      {optimization.optimized_tags.map((tag, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
                          #{tag.replace(/^#/, '')}
                        </span>
                      ))}
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(optimization.optimized_tags.join(', ')); toast.success('Tags copied!'); }}
                      className="text-xs text-primary hover:underline flex items-center gap-1">
                      📋 Copy all tags
                    </button>
                  </div>

                  {/* Name Suggestions */}
                  {optimization.name_suggestions.length > 0 && (
                    <div className="glow-card rounded-xl p-6 space-y-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">✏️ Channel Name Suggestions</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {optimization.name_suggestions.map((name, i) => (
                          <div key={i} className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                            i === 0 ? 'bg-primary/10 border-primary/30' : 'bg-card-border/30 border-card-border'
                          }`}>
                            <span className="text-sm font-medium">{name}</span>
                            {i === 0 && <span className="text-[10px] text-primary font-semibold px-2 py-0.5 rounded-full bg-primary/20">Recommended</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Banner Text */}
                  {optimization.banner_text.headline && (
                    <div className="glow-card rounded-xl p-6 space-y-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">🖼️ Banner Text</h3>
                      <div className="p-6 rounded-xl bg-gradient-to-r from-purple-500/10 via-cyan-500/5 to-purple-500/10 border border-purple-500/20 text-center">
                        <p className="text-xl font-bold gradient-text">{optimization.banner_text.headline}</p>
                        {optimization.banner_text.subheadline && (
                          <p className="text-sm text-muted mt-1">{optimization.banner_text.subheadline}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Logo Concept */}
                  {optimization.logo_concept && (
                    <div className="glow-card rounded-xl p-6 space-y-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">🎨 Logo Concept</h3>
                      <p className="text-sm text-foreground/80 leading-relaxed">{optimization.logo_concept}</p>
                    </div>
                  )}

                  {/* Viral Video Ideas */}
                  <div className="glow-card rounded-xl p-6 space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">🔥 Viral Video Ideas <span className="text-xs text-muted font-normal">({optimization.viral_video_ideas.length})</span></h3>
                    <div className="space-y-2">
                      {optimization.viral_video_ideas.map((idea, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-card-border/30 border border-card-border hover:border-primary/20 transition-colors">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            i === 0 ? 'bg-amber-500/20 text-amber-400' :
                            i < 3 ? 'bg-primary/20 text-primary' : 'bg-card-border/50 text-muted'
                          }`}>{i + 1}</span>
                          <p className="text-sm text-foreground/80">{idea}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SEO Boost */}
                  <div className="glow-card rounded-xl p-6 space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">📈 SEO Boost Pack</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Target Keywords</p>
                        <div className="flex flex-wrap gap-1.5">
                          {optimization.seo_boost.keywordsToTarget.map((kw, i) => (
                            <span key={i} className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{kw}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Hashtag Strategy</p>
                        <p className="text-sm text-foreground/80">{optimization.seo_boost.hashtagStrategy}</p>
                      </div>
                    </div>
                  </div>

                  {/* Monetization Plan */}
                  <div className="glow-card rounded-xl p-6 space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">💰 Monetization Plan</h3>
                    <p className="text-sm text-foreground/80 leading-relaxed">{optimization.monetization_plan}</p>
                  </div>

                  {/* Run another audit */}
                  <div className="text-center">
                    <button onClick={resetAudit} className="btn-primary">
                      🔍 Run Another Audit
                    </button>
                  </div>
                </>
              ) : (
                /* Optimize prompt card (if user hasn't clicked optimize yet while on optimization tab) */
                <div className="glow-card rounded-xl p-12 text-center">
                  <div className="space-y-4 max-w-md mx-auto">
                    <div className="text-5xl">⚡</div>
                    <h2 className="text-xl font-semibold">Optimization Ready</h2>
                    <p className="text-sm text-muted">Run the one-click optimization to generate your personalized optimization pack.</p>
                    <button onClick={runOptimization} disabled={optimizeLoading}
                      className="btn-primary mt-4 flex items-center gap-2 mx-auto">
                      {optimizeLoading ? (
                        <><span className="animate-spin">⚡</span> Optimizing...</>
                      ) : (
                        <><span>✨</span> Optimize Channel Now</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ────────────── TAB: Comparison ──────────────────────────────── */}
          {resultTab === 'comparison' && (
            <div className="space-y-6 animate-in">
              {/* Before/After Bar Chart */}
              <div className="glow-card rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">📊 Before vs After — Score Comparison</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData} barGap={4} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a24" />
                      <XAxis dataKey="category" stroke="#71717a" fontSize={11} />
                      <YAxis domain={[0, 100]} stroke="#71717a" fontSize={11} unit="%" />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="before" name="Before" radius={[4, 4, 0, 0]} maxBarSize={32}>
                        {comparisonData.map((entry, i) => (
                          <Cell key={i} fill={getScoreColor(entry.before)} fillOpacity={0.5} />
                        ))}
                      </Bar>
                      <Bar dataKey="after" name="After (Estimated)" radius={[4, 4, 0, 0]} maxBarSize={32}>
                        {comparisonData.map((entry, i) => (
                          <Cell key={i} fill={getScoreColor(entry.after)} fillOpacity={0.9} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-6 mt-4 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm opacity-50" style={{ background: '#34d399' }} />
                    Before
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm" style={{ background: '#8b5cf6' }} />
                    After (Optimized)
                  </div>
                </div>
              </div>

              {/* Summary Table */}
              <div className="glow-card rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">📋 Transformation Summary</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border">
                        <th className="text-left py-3 px-2 text-muted font-medium">Metric</th>
                        <th className="text-center py-3 px-2 text-muted font-medium">Before</th>
                        <th className="text-center py-3 px-2 text-muted font-medium">After</th>
                        <th className="text-center py-3 px-2 text-muted font-medium">Improvement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonData.map((item) => {
                        const diff = item.after - item.before;
                        return (
                          <tr key={item.category} className="border-b border-card-border/50 hover:bg-card-border/20 transition-colors">
                            <td className="py-3 px-2 font-medium">{item.category}</td>
                            <td className="py-3 px-2 text-center">
                              <span className="text-red-400">{item.before}%</span>
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className="text-emerald-400">{item.after}%</span>
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className={`font-semibold ${diff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                +{diff}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-primary/5 font-semibold">
                        <td className="py-3 px-2">Overall Score</td>
                        <td className="py-3 px-2 text-center text-red-400">{auditReport.final_score}%</td>
                        <td className="py-3 px-2 text-center text-emerald-400">
                          {Math.min(100, auditReport.final_score + 30)}%
                        </td>
                        <td className="py-3 px-2 text-center text-emerald-400">
                          +{Math.min(100, auditReport.final_score + 30) - auditReport.final_score}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Radar overlay comparison */}
              <div className="glow-card rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">🎯 Multi-Dimension Comparison</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={comparisonRadarData} cx="50%" cy="50%" outerRadius="70%">
                      <PolarGrid stroke="#1a1a24" />
                      <PolarAngleAxis dataKey="category" tick={{ fill: '#71717a', fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Radar name="Before" dataKey="before" stroke="#f87171" fill="#f87171" fillOpacity={0.15} strokeWidth={1.5} strokeDasharray="4 4" />
                      <Radar name="After (Estimated)" dataKey="after"
                        stroke="#34d399" fill="#34d399" fillOpacity={0.25} strokeWidth={2}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-0.5 border-t-2 border-dashed border-red-400" />
                    Before
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-0.5 border-t-2 border-solid border-emerald-400" />
                    After
                  </div>
                </div>
              </div>

              {optimization && (
                <div className="glow-card rounded-xl p-6 space-y-3 border-emerald-500/20 bg-emerald-500/5">
                  <h3 className="text-lg font-semibold flex items-center gap-2">🚀 Expected Impact</h3>
                  <p className="text-sm text-foreground/80 leading-relaxed">{optimization.before_vs_after.expectedImprovement}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Optimize loading overlay — shown during optimization API call */}
      {optimizeLoading && step === 'result' && (
        <div className="glow-card rounded-xl p-12 text-center animate-in">
          <div className="space-y-4 max-w-md mx-auto">
            <div className="text-5xl animate-bounce">⚡</div>
            <h2 className="text-xl font-semibold">Optimizing Your Channel</h2>
            <p className="text-sm text-muted">Generating optimized description, tags, content strategy & more...</p>
            <div className="w-full bg-card-border rounded-full h-2 mt-4 overflow-hidden">
              <div className="bg-gradient-to-r from-primary to-secondary h-full rounded-full animate-pulse"
                style={{ width: '80%' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
