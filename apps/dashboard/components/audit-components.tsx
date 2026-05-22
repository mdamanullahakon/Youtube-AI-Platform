'use client';

import type { ReactNode } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type PipelineStep = 'select' | 'audit' | 'result' | 'optimize';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getScoreColor(score: number): string {
  if (score >= 70) return '#34d399';
  if (score >= 40) return '#facc15';
  return '#f87171';
}

export function getHealthStatus(score: number): { label: string; color: string; emoji: string } {
  if (score >= 70) return { label: 'Optimized', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', emoji: '🟢' };
  if (score >= 40) return { label: 'Needs Improvement', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', emoji: '🟡' };
  return { label: 'Critical Issues', color: 'text-red-400 bg-red-500/10 border-red-500/20', emoji: '🔴' };
}

export function getMode(score: number): string {
  if (score < 25) return '🔴 Full Rebrand';
  if (score < 40) return '🟠 Partial Rebrand';
  if (score < 60) return '🟡 Aggressive Optimization';
  return '🟢 Fine Tuning';
}

// ─── ScoreGauge ─────────────────────────────────────────────────────────────

export function ScoreGauge({ score, label, size = 'md' }: { score: number; label: string; size?: 'sm' | 'md' | 'lg' }) {
  const circumference = size === 'lg' ? 220 : size === 'sm' ? 120 : 160;
  const radius = circumference / (2 * Math.PI);
  const strokeWidth = size === 'lg' ? 10 : size === 'sm' ? 6 : 8;
  const offset = circumference - (score / 100) * circumference;
  const fontClass = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-base' : 'text-xl';
  const svgSize = radius * 2 + strokeWidth;
  const color = getScoreColor(score);

  return (
    <div className="flex flex-col items-center gap-1" data-testid="score-gauge">
      <div className="relative flex items-center justify-center" style={{ width: svgSize, height: svgSize }}>
        <svg width={svgSize} height={svgSize} className="transform -rotate-90 absolute inset-0">
          <circle cx={radius + strokeWidth / 2} cy={radius + strokeWidth / 2} r={radius} fill="none"
            stroke="#1a1a24" strokeWidth={strokeWidth} data-testid="gauge-track" />
          <circle cx={radius + strokeWidth / 2} cy={radius + strokeWidth / 2} r={radius} fill="none"
            stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" className="transition-all duration-1000 ease-out" data-testid="gauge-progress" />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center ${fontClass} font-bold`} style={{ color }} data-testid="gauge-value">
          {Math.round(score)}
        </span>
      </div>
      {size !== 'sm' && <p className="text-xs text-muted mt-1" data-testid="gauge-label">{label}</p>}
    </div>
  );
}

// ─── InfoRow ────────────────────────────────────────────────────────────────

export function InfoRow({ label, value }: { label: string; value: string | number | ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-card-border/50 last:border-0" data-testid="info-row">
      <span className="text-sm text-muted" data-testid="info-label">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%]" data-testid="info-value">{value}</span>
    </div>
  );
}

// ─── ChipList ───────────────────────────────────────────────────────────────

export function ChipList({ items, label, color = 'primary' }: { items: string[]; label?: string; color?: string }) {
  if (!items?.length) return null;

  const chipColor = color === 'primary' ? 'bg-primary/10 text-primary border-primary/20' :
    color === 'emerald' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
    color === 'amber' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
    'bg-card-border/50 border-card-border text-foreground';

  return (
    <div className="space-y-1.5" data-testid="chip-list">
      {label && <p className="text-xs font-semibold text-muted uppercase tracking-wider" data-testid="chip-list-label">{label}</p>}
      <div className="flex flex-wrap gap-1.5" data-testid="chip-list-items">
        {items.map((item, i) => (
          <span key={i} className={`text-xs px-2.5 py-1 rounded-full border ${chipColor}`} data-testid={`chip-item-${i}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── AnimatedScoreBar ───────────────────────────────────────────────────────

export function AnimatedScoreBar({ score, label, color }: { score: number; label: string; color: string }) {
  const barColor = getScoreColor(score);
  return (
    <div className="space-y-1" data-testid="animated-score-bar">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted" data-testid="bar-label">{label}</span>
        <span className="text-xs font-bold" style={{ color: barColor }} data-testid="bar-score">{Math.round(score)}%</span>
      </div>
      <div className="w-full bg-card-border rounded-full h-2 overflow-hidden" data-testid="bar-track">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${score}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }}
          data-testid="bar-fill"
          role="progressbar"
          aria-valuenow={Math.round(score)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

// ─── TabBar ─────────────────────────────────────────────────────────────────

export interface TabItem {
  key: string;
  label: string;
  icon: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  active: string;
  onSelect: (key: string) => void;
}

export function TabBar({ tabs, active, onSelect }: TabBarProps) {
  return (
    <div className="flex gap-1 flex-wrap border-b border-card-border pb-1 mb-6" data-testid="tab-bar" role="tablist">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          role="tab"
          aria-selected={active === t.key}
          data-testid={`tab-${t.key}`}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
            active === t.key
              ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm'
              : 'text-muted hover:text-foreground hover:bg-card-border/30'
          }`}
        >
          <span>{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── PipelineStepper ────────────────────────────────────────────────────────

export function PipelineStepper({ currentStep }: { currentStep: PipelineStep }) {
  const steps = [
    { key: 'select' as const, label: 'Select Channel', icon: '🎯' },
    { key: 'audit' as const, label: 'Channel Audit', icon: '🔍' },
    { key: 'result' as const, label: 'View Results', icon: '📊' },
    { key: 'optimize' as const, label: 'Optimize', icon: '✨' },
  ];

  const currentIdx = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="flex items-center justify-between w-full max-w-2xl mx-auto mb-8 px-2" data-testid="pipeline-stepper">
      {steps.map((step, i) => {
        const isCompleted = i < currentIdx;
        const isActive = i === currentIdx;
        const isPast = i <= currentIdx;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                data-testid={`step-${step.key}`}
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                  isCompleted ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500' :
                  isActive ? 'bg-primary/20 text-primary border-2 border-primary shadow-lg shadow-primary/20' :
                  'bg-card-border/30 text-muted border-2 border-card-border'
                }`}
              >
                {isCompleted ? '✓' : step.icon}
              </div>
              <span
                data-testid={`step-label-${step.key}`}
                className={`text-[10px] font-medium whitespace-nowrap transition-colors ${
                  isPast ? 'text-foreground' : 'text-muted'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                data-testid={`step-connector-${step.key}`}
                className={`flex-1 h-[2px] mx-2 mb-5 transition-colors duration-300 ${
                  i < currentIdx ? 'bg-emerald-500/50' : 'bg-card-border'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
