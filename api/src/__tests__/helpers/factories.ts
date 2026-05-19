import { v4 as uuidv4 } from 'uuid';

// ─── User Factories ────────────────────────────────
export function buildUserInput(overrides: Partial<{ email: string; password: string; name: string }> = {}) {
  return {
    email: 'test@example.com',
    password: 'TestPass123!',
    name: 'Test User',
    ...overrides,
  };
}

export function buildLoginInput(overrides: Partial<{ email: string; password: string }> = {}) {
  return {
    email: 'test@example.com',
    password: 'TestPass123!',
    ...overrides,
  };
}

export function buildPrismaUser(overrides: Record<string, any> = {}) {
  const id = uuidv4();
  return {
    id,
    email: 'test@example.com',
    password: '$2b$12$LJ3m4ys3Lk0TSwHnbfOMiOXPm1Qlq5p3cRnZVJ0n5vX6y7A8b9Cdq', // "TestPass123!"
    name: 'Test User',
    avatar: null,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildPrismaSubscription(overrides: Record<string, any> = {}) {
  return {
    id: uuidv4(),
    userId: 'user-id',
    plan: 'free',
    status: 'active',
    videoLimit: 10,
    videosUsed: 0,
    renewsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildPrismaSettings(overrides: Record<string, any> = {}) {
  return {
    id: uuidv4(),
    userId: 'user-id',
    geminiKey: null,
    youtubeApiKey: null,
    preferredModel: 'ollama',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Token Factories ───────────────────────────────
export function buildTokenPair(overrides: Record<string, any> = {}) {
  return {
    token: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    ...overrides,
  };
}

// ─── Queue / Pipeline Factories ────────────────────
export function buildPipelineJobData(overrides: Record<string, any> = {}) {
  return {
    projectId: uuidv4(),
    topic: 'test-topic',
    ...overrides,
  };
}

// ─── Request Factories ─────────────────────────────
export function buildMockRequest(overrides: Record<string, any> = {}) {
  const body = overrides.body || {};
  const headers = overrides.headers || {};
  const cookies = overrides.cookies || {};
  const params = overrides.params || {};
  const query = overrides.query || {};

  return {
    body,
    headers,
    cookies,
    params,
    query,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: vi.fn((name: string) => headers[name]),
    header: vi.fn((name: string) => headers[name]),
    ...overrides,
  } as any;
}

export function buildMockResponse() {
  const res: Record<string, any> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
  return res as any;
}

export function buildMockNext() {
  return vi.fn();
}

// ─── Job Factories ─────────────────────────────────
export function buildMockJob(overrides: Record<string, any> = {}) {
  return {
    id: 'mock-job-id',
    name: 'test-job',
    data: {},
    progress: 0,
    attemptsMade: 0,
    failedReason: null,
    timestamp: Date.now(),
    returnvalue: null,
    stacktrace: [],
    updateProgress: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}
