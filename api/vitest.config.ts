import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      JWT_SECRET: 'test-jwt-secret-min-32-chars-long-!!',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-min-32-chars-!!',
      NODE_ENV: 'test',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    },
    include: ['src/__tests__/**/*.{test,spec}.{ts,js}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: path.resolve(__dirname, 'coverage'),
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/__tests__/**',
        'src/types/**',
        'src/**/*.d.ts',
      ],
      thresholds: {
        branches: 6,
        functions: 8,
        lines: 8,
        statements: 7,
      },
    },
    testTimeout: 15_000,
    hookTimeout: 20_000,
    sequence: {
      seed: Date.now(),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@test': path.resolve(__dirname, 'src/__tests__'),
    },
  },
});
