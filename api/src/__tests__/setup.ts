import './utils/mock-setup';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long-!!';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-min-32-chars-!!';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.JWT_ISSUER = 'youtube-ai-platform-test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/youtube_ai_platform_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.COOKIE_DOMAIN = '';
process.env.COOKIE_SAME_SITE = 'lax';
process.env.YOUTUBE_CLIENT_ID = '123456789-testapp.apps.googleusercontent.com';
process.env.YOUTUBE_CLIENT_SECRET = 'placeholder_secret';
process.env.YOUTUBE_REFRESH_TOKEN = 'placeholder_refresh';
process.env.ENABLE_LEGACY_QUEUE_PIPELINE = 'true';

