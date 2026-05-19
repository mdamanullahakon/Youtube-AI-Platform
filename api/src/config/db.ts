import { PrismaClient } from '@prisma/client';

const isProduction = process.env.NODE_ENV === 'production';
const poolMin = parseInt(process.env.DB_POOL_MIN || '2', 10);
const poolMax = parseInt(process.env.DB_POOL_MAX || '10', 10);

function buildDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || '';
  if (!baseUrl) return '';

  // Only append pool params if not already present
  if (baseUrl.includes('connection_limit=')) return baseUrl;

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}connection_limit=${poolMax}&pool_timeout=30`;
}

export const prisma = new PrismaClient({
  log: isProduction ? ['error'] : ['error', 'warn'],
  datasources: {
    db: {
      url: buildDatabaseUrl(),
    },
  },
});

// Graceful shutdown helper
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { poolMin, poolMax };
