import { PrismaClient } from '@prisma/client';

const isProduction = process.env.NODE_ENV === 'production';
const poolMin = parseInt(process.env.DB_POOL_MIN || '2', 10);
const poolMax = parseInt(process.env.DB_POOL_MAX || '10', 10);

/**
 * Build a database URL with connection pooling parameters.
 *
 * PgBouncer (transaction mode) support:
 *   Set PGBOUNCER_URL as the PgBouncer connection string.
 *   With PgBouncer, Prisma MUST use `relationMode = "prisma"` (set in schema.prisma)
 *   because PgBouncer does not support server-side cursors or prepared statements
 *   across transactions.
 */
function buildDatabaseUrl(): string {
  // Use PgBouncer URL if provided (transaction pooling mode)
  const baseUrl = process.env.PGBOUNCER_URL || process.env.DATABASE_URL || '';
  if (!baseUrl) return '';

  // Only append pool params if not already present
  if (baseUrl.includes('connection_limit=')) return baseUrl;

  const separator = baseUrl.includes('?') ? '&' : '?';
  const poolUrl = `${baseUrl}${separator}connection_limit=${poolMax}&pool_timeout=30`;

  // Disable prepared statements for PgBouncer transaction mode compatibility
  if (process.env.PGBOUNCER_URL) {
    return `${poolUrl}&pgbouncer=true&statement_cache_size=0`;
  }

  return poolUrl;
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
