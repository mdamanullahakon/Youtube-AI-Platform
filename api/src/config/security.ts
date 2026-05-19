export const securityConfig = {
  rateLimits: {
    global: { window: 60, max: 60 },
    auth: { window: 60, max: 10 },
    ai: { window: 60, max: 10 },
    upload: { window: 60, max: 5 },
  },
  body: {
    jsonLimit: '10mb',
    urlencodedLimit: '10mb',
  },
  cors: {
    maxAge: 86400,
  },
  jwt: {
    accessExpiry: '15m',
    refreshExpiry: '7d',
  },
  ai: {
    dailyLimitFree: 50,
    dailyLimitPro: 500,
    cacheTtl: 3600,
    maxTokens: 4096,
  },
  cleanup: {
    tempRetentionHours: 24,
    maxTempSize: 500 * 1024 * 1024,
  },
};
