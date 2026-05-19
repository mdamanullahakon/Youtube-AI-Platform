'use client';

import { create } from 'zustand';

export type ConfigSection = 'gemini' | 'youtube' | 'smtp' | 'transcript';

export interface ConfigItem {
  key: string;
  label: string;
  section: ConfigSection;
  link: string;
  docUrl: string;
  present: boolean;
  source: 'env' | 'database' | 'missing';
}

export interface TestResult {
  success: boolean;
  message: string;
  details?: string;
}

export type StepId = 'welcome' | 'gemini' | 'youtube' | 'smtp' | 'transcript' | 'complete';

interface ConfigState {
  configs: ConfigItem[];
  loading: boolean;
  fetched: boolean;
  activeStep: StepId;
  testResults: Record<string, TestResult | null>;
  testingSection: string | null;
  assistantOpen: boolean;

  setConfigs: (configs: ConfigItem[]) => void;
  setLoading: (loading: boolean) => void;
  setFetched: (fetched: boolean) => void;
  setActiveStep: (step: StepId) => void;
  setTestResult: (section: string, result: TestResult | null) => void;
  setTestingSection: (section: string | null) => void;
  setAssistantOpen: (open: boolean) => void;

  getMissing: () => ConfigItem[];
  getConfiguredCount: () => number;
  getTotalCount: () => number;
  isFullyConfigured: () => boolean;
  isSectionConfigured: (section: ConfigSection) => boolean;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  configs: [],
  loading: false,
  fetched: false,
  activeStep: 'welcome',
  testResults: {},
  testingSection: null,
  assistantOpen: false,

  setConfigs: (configs) => set({ configs, fetched: true }),
  setLoading: (loading) => set({ loading }),
  setFetched: (fetched) => set({ fetched }),
  setActiveStep: (step) => set({ activeStep: step }),
  setTestResult: (section, result) =>
    set((state) => ({ testResults: { ...state.testResults, [section]: result } })),
  setTestingSection: (section) => set({ testingSection: section }),
  setAssistantOpen: (open) => set({ assistantOpen: open }),

  getMissing: () => get().configs.filter((c) => !c.present),
  getConfiguredCount: () => get().configs.filter((c) => c.present).length,
  getTotalCount: () => get().configs.length,
  isFullyConfigured: () => {
    const { configs } = get();
    return configs.length > 0 && configs.every((c) => c.present);
  },
  isSectionConfigured: (section) => {
    const sectionConfigs = get().configs.filter((c) => c.section === section);
    return sectionConfigs.length > 0 && sectionConfigs.every((c) => c.present);
  },
}));
