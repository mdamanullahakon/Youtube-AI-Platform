'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { apiClient } from '@/store';
import { useConfigStore, type StepId, type ConfigSection } from '@/store/config-store';

const STEPS: { id: StepId; label: string; icon: string }[] = [
  { id: 'welcome', label: 'Welcome', icon: '👋' },
  { id: 'gemini', label: 'Gemini AI', icon: '🧠' },
  { id: 'youtube', label: 'YouTube', icon: '▶️' },
  { id: 'smtp', label: 'Email SMTP', icon: '📧' },
  { id: 'transcript', label: 'Transcript', icon: '🎤' },
  { id: 'complete', label: 'Complete', icon: '🎉' },
];

const STEP_SECTION_MAP: Record<string, ConfigSection> = {
  gemini: 'gemini',
  youtube: 'youtube',
  smtp: 'smtp',
  transcript: 'transcript',
};

const SECTION_GUIDES: Record<ConfigSection, { steps: string[]; externalLink: { url: string; label: string } }> = {
  gemini: {
    steps: [
      'Go to Google AI Studio',
      'Sign in with your Google account',
      'Click "Get API Key" in the left sidebar',
      'Create a new API key or use an existing one',
      'Copy the key and paste it below',
    ],
    externalLink: { url: 'https://aistudio.google.com/apikey', label: 'Open Google AI Studio' },
  },
  youtube: {
    steps: [
      'Go to Google Cloud Console → APIs & Services',
      'Create a new project or select existing one',
      'Enable YouTube Data API v3',
      'Go to Credentials → Create Credentials → OAuth 2.0 Client ID',
      'Choose "Web application", set redirect URI to: http://localhost:4000/api/auth/youtube/callback',
      'Copy the generated Client ID and Client Secret into the fields below',
      'Then click "Connect YouTube Channel" on the Settings page to complete OAuth flow',
      'After connecting, the refresh token is stored automatically',
    ],
    externalLink: { url: 'https://console.cloud.google.com/apis/credentials', label: 'Open Google Cloud Console' },
  },
  smtp: {
    steps: [
      'For Gmail: Enable 2-Step Verification on your Google account',
      'Go to Google Account Security → App Passwords',
      'Select "Mail" and your device, then generate a password',
      'Use the generated 16-character app password below',
      'Host: smtp.gmail.com | Port: 587 | Secure: No (STARTTLS)',
    ],
    externalLink: { url: 'https://myaccount.google.com/apppasswords', label: 'Create Gmail App Password' },
  },
  transcript: {
    steps: [
      'Choose a transcription provider:',
      'Option 1: OpenAI Whisper API (recommended) - Get API key from OpenAI',
      'Option 2: AssemblyAI - Sign up at assemblyai.com',
      'Option 3: YouTube Captions API (no key needed for public videos)',
      'Paste your API key below',
    ],
    externalLink: { url: 'https://platform.openai.com/api-keys', label: 'Get OpenAI API Key' },
  },
};

function StepIndicator({ currentStep, configs }: { currentStep: StepId; configs: { key: string; section: string; present: boolean }[] }) {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center justify-center gap-1 mb-8">
      {STEPS.map((step, idx) => {
        const sectionConfigs = configs.filter((c) => c.section === step.id && step.id in STEP_SECTION_MAP);
        const stepComplete = step.id === 'welcome' || step.id === 'complete' || sectionConfigs.every((c) => c.present);
        const isActive = idx === currentIdx;
        const isPast = idx < currentIdx;

        return (
          <div key={step.id} className="flex items-center">
            {idx > 0 && (
              <div className={`w-8 h-0.5 ${isPast || stepComplete ? 'bg-primary' : 'bg-card-border'}`} />
            )}
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm transition-all border-2 ${
                  isActive
                    ? 'bg-primary border-primary text-white shadow-lg shadow-primary/30 scale-110'
                    : isPast || stepComplete
                      ? 'bg-primary/20 border-primary text-primary'
                      : 'bg-card border-card-border text-muted'
                }`}
              >
                {isPast || (stepComplete && step.id !== 'complete') ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span>{step.icon}</span>
                )}
              </div>
              <span className={`text-xs mt-1 hidden sm:block ${isActive ? 'text-primary font-medium' : 'text-muted'}`}>
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    { role: 'assistant', text: '👋 Hi! I can help you set up your platform. Ask me anything about API keys, OAuth, or troubleshooting.' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const query = input.trim();
    if (!query || sending) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    setSending(true);

    try {
      const data = await apiClient('/api/config/assistant', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer || 'Sorry, I couldn\'t process that.' }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'I\'m having trouble connecting. Please try again.' }]);
    }
    setSending(false);
  };

  const quickQuestions = [
    'How to get Gemini API key?',
    'Why is SMTP not working?',
    'How to connect YouTube?',
    'Transcript API options?',
  ];

  return (
    <div className="fixed bottom-4 right-4 w-96 max-w-[calc(100vw-2rem)] h-[500px] max-h-[70vh] bg-card border border-card-border rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-card-border bg-background/50">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <span className="font-semibold text-sm">Setup Assistant</span>
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-background text-foreground border border-card-border rounded-bl-md'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-background border border-card-border rounded-2xl rounded-bl-md px-4 py-2.5">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length === 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {quickQuestions.map((q) => (
            <button
              key={q}
              onClick={() => {
                setMessages((prev) => [...prev, { role: 'user', text: q }]);
                setSending(true);
                apiClient('/api/config/assistant', {
                  method: 'POST',
                  body: JSON.stringify({ query: q }),
                }).then((data) => {
                  setMessages((prev) => [...prev, { role: 'assistant', text: data.answer || 'No answer available.' }]);
                }).catch(() => {}).finally(() => setSending(false));
              }}
              className="text-xs bg-background border border-card-border rounded-full px-3 py-1.5 text-muted hover:text-foreground hover:border-primary/30 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="p-3 border-t border-card-border">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about setup..."
            className="input-field flex-1 text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="btn-primary !p-2.5 !rounded-xl disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const {
    configs,
    setConfigs,
    activeStep,
    setActiveStep,
    testResults,
    setTestResult,
    testingSection,
    setTestingSection,
    assistantOpen,
    setAssistantOpen,
  } = useConfigStore();

  const { data: statusData, isLoading, refetch } = useQuery({
    queryKey: ['config-status'],
    queryFn: () => apiClient('/api/config/status'),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (statusData?.success && Array.isArray(statusData.data)) {
      setConfigs(statusData.data);
    }
  }, [statusData, setConfigs]);

  useEffect(() => {
    if (!isLoading && configs.length > 0 && activeStep === 'welcome') {
      const missing = configs.filter((c) => !c.present);
      if (missing.length === 0) {
        setActiveStep('complete');
      } else {
        const firstMissing = STEPS.find((s) =>
          s.id !== 'welcome' && s.id !== 'complete' && configs.filter((c) => c.section === s.id).some((c) => !c.present)
        );
        if (firstMissing) setActiveStep(firstMissing.id);
      }
    }
  }, [isLoading, configs, activeStep, setActiveStep]);

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiClient('/api/config/set', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      }),
    onSuccess: (data, variables) => {
      if (data.success) {
        toast.success(`${variables.key} saved!`);
        refetch();
        queryClient.invalidateQueries({ queryKey: ['config-status'] });
      } else {
        toast.error(data.message || `Failed to save ${variables.key}`);
      }
    },
    onError: () => toast.error('Network error saving config'),
  });

  const testMutation = useMutation({
    mutationFn: (section: string) =>
      apiClient('/api/config/test', {
        method: 'POST',
        body: JSON.stringify({ section }),
      }),
    onSuccess: (data, section) => {
      setTestResult(section, { success: data.success, message: data.message, details: data.details });
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (_, section) => {
      setTestResult(section, { success: false, message: 'Network error running test' });
      toast.error('Network error running test');
    },
  });

  const handleSave = (key: string) => {
    const value = inputValues[key];
    if (!value || value.trim().length === 0) {
      toast.error('Please enter a value');
      return;
    }
    saveMutation.mutate({ key, value: value.trim() });
    setInputValues((prev) => ({ ...prev, [key]: '' }));
  };

  const handleTest = (section: string) => {
    setTestingSection(section);
    setTestResult(section, null);
    testMutation.mutate(section);
  };

  const missingCount = configs.filter((c) => !c.present).length;
  const totalCount = configs.length;
  const progressPercent = totalCount > 0 ? Math.round(((totalCount - missingCount) / totalCount) * 100) : 0;
  const allConfigured = missingCount === 0 && totalCount > 0;

  const renderStepContent = () => {
    if (activeStep === 'welcome' || activeStep === 'complete') return null;

    const section = activeStep as ConfigSection;
    const sectionConfigs = configs.filter((c) => c.section === section);
    const guide = SECTION_GUIDES[section];
    const sectionConfigured = sectionConfigs.every((c) => c.present);
    const testResult = testResults[section];
    const isTesting = testingSection === section;

    return (
      <div className="space-y-6">
        <div className="glow-card rounded-xl p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">{STEPS.find((s) => s.id === section)?.icon} {guide.externalLink.label}</h2>
              <p className="text-sm text-muted">Configure your {section} integration</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-medium border ${
              sectionConfigured
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
            }`}>
              {sectionConfigured ? 'Configured' : 'Not configured'}
            </div>
          </div>

          <div className="bg-background rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Step-by-step guide</h3>
            <ol className="space-y-2">
              {guide.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-primary font-bold shrink-0 w-5">{i + 1}.</span>
                  <span className="text-foreground/80">{step}</span>
                </li>
              ))}
            </ol>
            <a
              href={guide.externalLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-2 text-sm text-primary hover:underline font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {guide.externalLink.label}
            </a>
          </div>

          <div className="space-y-4">
            {sectionConfigs.map((cfg) => (
              <div key={cfg.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">{cfg.label}</label>
                  {cfg.present && (
                    <span className="text-xs text-green-400">✓ Set via {cfg.source}</span>
                  )}
                </div>
                {!cfg.present && (
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={inputValues[cfg.key] ?? ''}
                      onChange={(e) => setInputValues((prev) => ({ ...prev, [cfg.key]: e.target.value }))}
                      placeholder={`Enter your ${cfg.label}`}
                      className="input-field flex-1"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSave(cfg.key)}
                      disabled={saveMutation.isPending}
                      className="btn-primary whitespace-nowrap"
                    >
                      {saveMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-card-border">
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleTest(section)}
                disabled={isTesting || sectionConfigs.every((c) => !c.present)}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                {isTesting ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                    Testing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Test Connection
                  </>
                )}
              </button>

              {sectionConfigs.every((c) => !c.present) && (
                <span className="text-xs text-muted">Save a key first to test</span>
              )}
            </div>

            {testResult && (
              <div className={`mt-3 p-3 rounded-xl text-sm ${
                testResult.success
                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}>
                <div className="flex items-start gap-2">
                  <span>{testResult.success ? '✓' : '✗'}</span>
                  <div>
                    <p className="font-medium">{testResult.message}</p>
                    {testResult.details && (
                      <p className="text-xs mt-1 opacity-80">{testResult.details}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between">
          <button
            onClick={() => {
              const idx = STEPS.findIndex((s) => s.id === activeStep);
              setActiveStep(STEPS[Math.max(0, idx - 1)].id);
            }}
            className="btn-secondary"
          >
            ← Back
          </button>

          {sectionConfigured ? (
            <button
              onClick={() => {
                const idx = STEPS.findIndex((s) => s.id === activeStep);
                const nextIdx = Math.min(STEPS.length - 1, idx + 1);
                if (nextIdx === STEPS.length - 1 && missingCount > 0) {
                  // Find next unconfigured section
                  const nextMissing = STEPS.find((s) =>
                    s.id !== 'welcome' && s.id !== 'complete' &&
                    s.id !== activeStep &&
                    configs.filter((c) => c.section === s.id).some((c) => !c.present)
                  );
                  if (nextMissing) {
                    setActiveStep(nextMissing.id);
                    return;
                  }
                }
                setActiveStep(STEPS[nextIdx].id);
              }}
              className="btn-primary"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={() => {
                const idx = STEPS.findIndex((s) => s.id === activeStep);
                setActiveStep(STEPS[Math.min(STEPS.length - 1, idx + 1)].id);
              }}
              className="btn-secondary"
            >
              Skip for now →
            </button>
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold gradient-text">Platform Setup</h1>
          <p className="text-muted text-base max-w-xl mx-auto">
            Follow the steps to configure your services. All data is encrypted at rest.
          </p>
        </div>

        <div className="glow-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {allConfigured ? '✨ All configured!' : `Progress`}
            </span>
            <span className="text-sm text-muted">{totalCount - missingCount} / {totalCount}</span>
          </div>
          <div className="w-full h-2.5 bg-card-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                allConfigured ? 'bg-green-500' : 'bg-gradient-to-r from-primary to-secondary'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <StepIndicator currentStep={activeStep} configs={configs} />

        {activeStep === 'welcome' && (
          <div className="glow-card rounded-xl p-8 text-center space-y-5">
            <div className="text-6xl">🚀</div>
            <h2 className="text-2xl font-bold">Welcome to Your AI Platform</h2>
            <p className="text-muted max-w-md mx-auto">
              Let&apos;s get your services configured. We&apos;ll guide you through each step with clear instructions.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <button
                onClick={() => {
                  const firstMissing = STEPS.find((s) =>
                    s.id !== 'welcome' && s.id !== 'complete' &&
                    configs.filter((c) => c.section === s.id).some((c) => !c.present)
                  );
                  setActiveStep(firstMissing?.id || 'gemini');
                }}
                className="btn-primary"
              >
                Start Setup
              </button>
              {allConfigured && (
                <button onClick={() => router.push('/dashboard')} className="btn-secondary">
                  Go to Dashboard
                </button>
              )}
            </div>
          </div>
        )}

        {activeStep !== 'welcome' && activeStep !== 'complete' && renderStepContent()}

        {activeStep === 'complete' && (
          <div className="glow-card rounded-xl p-8 text-center space-y-5">
            <div className="text-6xl">🎉</div>
            <h2 className="text-2xl font-bold gradient-text">All Systems Configured!</h2>
            <p className="text-muted max-w-md mx-auto">
              Your platform is ready to use. All required services are connected and operational.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
              {configs.map((cfg) => (
                <div key={cfg.key} className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-sm">
                  <span className="text-green-400 block font-medium">{cfg.label}</span>
                  <span className="text-green-400/60 text-xs">via {cfg.source}</span>
                </div>
              ))}
            </div>
            <button onClick={() => router.push('/dashboard')} className="btn-primary mt-2">
              Go to Dashboard
            </button>
          </div>
        )}

        <div className="glow-card rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Need help?</h3>
              <p className="text-xs text-muted mt-0.5">Ask our AI setup assistant</p>
            </div>
            <button
              onClick={() => setAssistantOpen(true)}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <span>🤖</span>
              Open Assistant
            </button>
          </div>
        </div>
      </div>

      {assistantOpen && <AssistantPanel onClose={() => setAssistantOpen(false)} />}
    </div>
  );
}
