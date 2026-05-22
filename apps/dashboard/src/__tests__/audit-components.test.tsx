import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  ScoreGauge,
  InfoRow,
  ChipList,
  AnimatedScoreBar,
  TabBar,
  PipelineStepper,
  getScoreColor,
  getHealthStatus,
  getMode,
} from '@/components/audit-components';

// ─── Helpers ────────────────────────────────────────────────────────────────

describe('getScoreColor', () => {
  it('returns green for scores >= 70', () => {
    expect(getScoreColor(100)).toBe('#34d399');
    expect(getScoreColor(70)).toBe('#34d399');
    expect(getScoreColor(85)).toBe('#34d399');
  });

  it('returns yellow for scores >= 40 and < 70', () => {
    expect(getScoreColor(69)).toBe('#facc15');
    expect(getScoreColor(40)).toBe('#facc15');
    expect(getScoreColor(55)).toBe('#facc15');
  });

  it('returns red for scores < 40', () => {
    expect(getScoreColor(39)).toBe('#f87171');
    expect(getScoreColor(0)).toBe('#f87171');
    expect(getScoreColor(20)).toBe('#f87171');
  });
});

describe('getHealthStatus', () => {
  it('returns Optimized for score >= 70', () => {
    const result = getHealthStatus(85);
    expect(result.label).toBe('Optimized');
    expect(result.emoji).toBe('🟢');
  });

  it('returns Needs Improvement for score 40-69', () => {
    const result = getHealthStatus(55);
    expect(result.label).toBe('Needs Improvement');
    expect(result.emoji).toBe('🟡');
  });

  it('returns Critical Issues for score < 40', () => {
    const result = getHealthStatus(25);
    expect(result.label).toBe('Critical Issues');
    expect(result.emoji).toBe('🔴');
  });
});

describe('getMode', () => {
  it('returns Full Rebrand for score < 25', () => {
    expect(getMode(0)).toContain('Full Rebrand');
    expect(getMode(24)).toContain('Full Rebrand');
  });

  it('returns Partial Rebrand for score 25-39', () => {
    expect(getMode(25)).toContain('Partial Rebrand');
    expect(getMode(39)).toContain('Partial Rebrand');
  });

  it('returns Aggressive Optimization for score 40-59', () => {
    expect(getMode(40)).toContain('Aggressive Optimization');
    expect(getMode(59)).toContain('Aggressive Optimization');
  });

  it('returns Fine Tuning for score >= 60', () => {
    expect(getMode(60)).toContain('Fine Tuning');
    expect(getMode(100)).toContain('Fine Tuning');
  });
});

// ─── ScoreGauge ─────────────────────────────────────────────────────────────

describe('ScoreGauge', () => {
  it('renders the score value and label', () => {
    render(<ScoreGauge score={75} label="Overall" />);
    expect(screen.getByTestId('gauge-value')).toHaveTextContent('75');
    expect(screen.getByTestId('gauge-label')).toHaveTextContent('Overall');
  });

  it('renders with different sizes', () => {
    const { rerender } = render(<ScoreGauge score={50} label="Test" size="sm" />);
    // Small size should not show the label
    expect(screen.queryByTestId('gauge-label')).toBeNull();

    rerender(<ScoreGauge score={50} label="Test" size="lg" />);
    expect(screen.getByTestId('gauge-value')).toBeInTheDocument();
    expect(screen.getByTestId('gauge-label')).toHaveTextContent('Test');
  });

  it('rounds the displayed score', () => {
    render(<ScoreGauge score={74.7} label="Score" />);
    expect(screen.getByTestId('gauge-value')).toHaveTextContent('75');
  });

  it('renders a green circle for high scores', () => {
    render(<ScoreGauge score={85} label="High" />);
    const progress = screen.getByTestId('gauge-progress');
    expect(progress).toHaveAttribute('stroke', '#34d399');
  });

  it('renders a yellow circle for medium scores', () => {
    render(<ScoreGauge score={50} label="Mid" />);
    const progress = screen.getByTestId('gauge-progress');
    expect(progress).toHaveAttribute('stroke', '#facc15');
  });

  it('renders a red circle for low scores', () => {
    render(<ScoreGauge score={20} label="Low" />);
    const progress = screen.getByTestId('gauge-progress');
    expect(progress).toHaveAttribute('stroke', '#f87171');
  });
});

// ─── InfoRow ────────────────────────────────────────────────────────────────

describe('InfoRow', () => {
  it('renders label and string value', () => {
    render(<InfoRow label="Views" value="1,234" />);
    expect(screen.getByTestId('info-label')).toHaveTextContent('Views');
    expect(screen.getByTestId('info-value')).toHaveTextContent('1,234');
  });

  it('renders label and numeric value', () => {
    render(<InfoRow label="Score" value={95} />);
    expect(screen.getByTestId('info-value')).toHaveTextContent('95');
  });

  it('renders value as ReactNode', () => {
    render(<InfoRow label="Status" value={<span data-testid="custom-node">Active</span>} />);
    expect(screen.getByTestId('custom-node')).toHaveTextContent('Active');
  });
});

// ─── ChipList ───────────────────────────────────────────────────────────────

describe('ChipList', () => {
  it('renders chips with items', () => {
    render(<ChipList items={['tag1', 'tag2', 'tag3']} label="Tags" />);
    expect(screen.getByTestId('chip-list')).toBeInTheDocument();
    expect(screen.getByTestId('chip-list-label')).toHaveTextContent('Tags');
    expect(screen.getByTestId('chip-item-0')).toHaveTextContent('tag1');
    expect(screen.getByTestId('chip-item-1')).toHaveTextContent('tag2');
    expect(screen.getByTestId('chip-item-2')).toHaveTextContent('tag3');
  });

  it('returns null for empty items', () => {
    const { container } = render(<ChipList items={[]} label="Empty" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for undefined items', () => {
    const { container } =    render(<ChipList items={undefined as unknown as string[]} label="Undefined" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders without label', () => {
    render(<ChipList items={['a', 'b']} />);
    expect(screen.queryByTestId('chip-list-label')).toBeNull();
    expect(screen.getByTestId('chip-item-0')).toHaveTextContent('a');
  });

  it('applies color variants', () => {
    render(<ChipList items={['warning']} label="Warn" color="amber" />);
    const chip = screen.getByTestId('chip-item-0');
    expect(chip.className).toContain('amber');
  });
});

// ─── AnimatedScoreBar ───────────────────────────────────────────────────────

describe('AnimatedScoreBar', () => {
  it('renders label and score percentage', () => {
    render(<AnimatedScoreBar score={65} label="SEO" color="#f59e0b" />);
    expect(screen.getByTestId('bar-label')).toHaveTextContent('SEO');
    expect(screen.getByTestId('bar-score')).toHaveTextContent('65%');
  });

  it('renders with correct width percentage', () => {
    render(<AnimatedScoreBar score={42} label="Test" color="#8b5cf6" />);
    const fill = screen.getByTestId('bar-fill');
    expect(fill).toHaveStyle({ width: '42%' });
  });

  it('has correct aria attributes as progressbar', () => {
    render(<AnimatedScoreBar score={88} label="Retention" color="#3b82f6" />);
    const fill = screen.getByTestId('bar-fill');
    expect(fill).toHaveAttribute('role', 'progressbar');
    expect(fill).toHaveAttribute('aria-valuenow', '88');
    expect(fill).toHaveAttribute('aria-valuemin', '0');
    expect(fill).toHaveAttribute('aria-valuemax', '100');
  });

  it('rounds score for display', () => {
    render(<AnimatedScoreBar score={73.9} label="Precision" color="#10b981" />);
    expect(screen.getByTestId('bar-score')).toHaveTextContent('74%');
  });

  it('renders green bar for high scores', () => {
    render(<AnimatedScoreBar score={80} label="High" color="#8b5cf6" />);
    const scoreEl = screen.getByTestId('bar-score');
    expect(scoreEl).toHaveStyle({ color: '#34d399' });
  });
});

// ─── TabBar ─────────────────────────────────────────────────────────────────

describe('TabBar', () => {
  const tabs = [
    { key: 'results', label: 'Audit Results', icon: '📊' },
    { key: 'optimize', label: 'Optimization', icon: '✨' },
    { key: 'compare', label: 'Comparison', icon: '📈' },
  ];

  it('renders all tabs', () => {
    render(<TabBar tabs={tabs} active="results" onSelect={() => {}} />);
    expect(screen.getByTestId('tab-results')).toBeInTheDocument();
    expect(screen.getByTestId('tab-optimize')).toBeInTheDocument();
    expect(screen.getByTestId('tab-compare')).toBeInTheDocument();
    expect(screen.getByTestId('tab-results')).toHaveTextContent('📊');
    expect(screen.getByTestId('tab-results')).toHaveTextContent('Audit Results');
  });

  it('marks active tab as selected', () => {
    render(<TabBar tabs={tabs} active="optimize" onSelect={() => {}} />);
    const activeTab = screen.getByTestId('tab-optimize');
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
    const inactiveTab = screen.getByTestId('tab-results');
    expect(inactiveTab).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelect when a tab is clicked', () => {
    const onSelect = vi.fn();
    render(<TabBar tabs={tabs} active="results" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('tab-optimize'));
    expect(onSelect).toHaveBeenCalledWith('optimize');
  });

  it('has proper role="tablist" and role="tab"', () => {
    render(<TabBar tabs={tabs} active="results" onSelect={() => {}} />);
    expect(screen.getByTestId('tab-bar')).toHaveAttribute('role', 'tablist');
    expect(screen.getByTestId('tab-results')).toHaveAttribute('role', 'tab');
  });
});

// ─── PipelineStepper ────────────────────────────────────────────────────────

describe('PipelineStepper', () => {
  it('renders all 4 steps', () => {
    render(<PipelineStepper currentStep="select" />);
    expect(screen.getByTestId('step-select')).toBeInTheDocument();
    expect(screen.getByTestId('step-audit')).toBeInTheDocument();
    expect(screen.getByTestId('step-result')).toBeInTheDocument();
    expect(screen.getByTestId('step-optimize')).toBeInTheDocument();
  });

  it('shows step labels', () => {
    render(<PipelineStepper currentStep="select" />);
    expect(screen.getByTestId('step-label-select')).toHaveTextContent('Select Channel');
    expect(screen.getByTestId('step-label-audit')).toHaveTextContent('Channel Audit');
    expect(screen.getByTestId('step-label-result')).toHaveTextContent('View Results');
    expect(screen.getByTestId('step-label-optimize')).toHaveTextContent('Optimize');
  });

  it('marks current step as active', () => {
    render(<PipelineStepper currentStep="audit" />);
    const auditStep = screen.getByTestId('step-audit');
    // Active step has primary border
    expect(auditStep.className).toContain('border-primary');
  });

  it('marks completed steps with checkmark', () => {
    render(<PipelineStepper currentStep="result" />);
    // Select and Audit should be completed (show ✓)
    const selectStep = screen.getByTestId('step-select');
    expect(selectStep).toHaveTextContent('✓');
    expect(selectStep.className).toContain('emerald');

    const auditStep = screen.getByTestId('step-audit');
    expect(auditStep).toHaveTextContent('✓');
    expect(auditStep.className).toContain('emerald');
  });

  it('shows icons for upcoming steps', () => {
    render(<PipelineStepper currentStep="audit" />);
    expect(screen.getByTestId('step-result')).toHaveTextContent('📊');
    expect(screen.getByTestId('step-optimize')).toHaveTextContent('✨');
  });

  it('renders connectors between steps', () => {
    render(<PipelineStepper currentStep="result" />);
    // Connectors between steps (select→audit, audit→result, result→optimize)
    expect(screen.getByTestId('step-connector-select')).toBeInTheDocument();
    expect(screen.getByTestId('step-connector-audit')).toBeInTheDocument();
    expect(screen.getByTestId('step-connector-result')).toBeInTheDocument();
  });

  it('completed connectors have green background', () => {
    render(<PipelineStepper currentStep="result" />);
    const connector = screen.getByTestId('step-connector-select');
    expect(connector.className).toContain('emerald');
  });

  it('upcoming connectors are neutral', () => {
    render(<PipelineStepper currentStep="select" />);
    const connector = screen.getByTestId('step-connector-select');
    expect(connector.className).toContain('card-border');
  });
});
