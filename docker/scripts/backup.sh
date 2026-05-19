#!/bin/sh
# ──────────────────────────────────────────────────────
# YouTube AI Platform — Database Backup Script
# ──────────────────────────────────────────────────────
# Backs up PostgreSQL (pg_dump) and Redis (RDB copy).
# Designed to run inside a Docker container or standalone.
#
# Usage:
#   docker exec yt-postgres /backup/backup.sh
#   ./docker/scripts/backup.sh                          # standalone with env vars
#
# Env vars:
#   BACKUP_DIR        - where to store backups (default: /backup)
#   PG_HOST           - PostgreSQL host (default: postgres)
#   PG_PORT           - PostgreSQL port (default: 5432)
#   PG_USER           - PostgreSQL user (default: $POSTGRES_USER or postgres)
#   PG_PASSWORD       - PostgreSQL password (default: $POSTGRES_PASSWORD)
#   PG_DATABASE       - Database name (default: $POSTGRES_DB or youtube_ai_platform)
#   REDIS_HOST        - Redis host (default: redis)
#   REDIS_PORT        - Redis port (default: 6379)
#   RETENTION_DAYS    - keep backups this long (default: 14)
# ──────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/backup}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR/postgres" "$BACKUP_DIR/redis"

echo "[$(date)] Starting backup..."

# ─── PostgreSQL Backup ────────────────────────────────
PG_HOST="${PG_HOST:-postgres}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-${POSTGRES_USER:-postgres}}"
PG_PASSWORD="${PG_PASSWORD:-${POSTGRES_PASSWORD:-postgres}}"
PG_DATABASE="${PG_DATABASE:-${POSTGRES_DB:-youtube_ai_platform}}"

PG_DUMP_FILE="$BACKUP_DIR/postgres/${PG_DATABASE}_${TIMESTAMP}.sql.gz"
echo "[$(date)] Backing up PostgreSQL: $PG_DATABASE@$PG_HOST:$PG_PORT"

export PGPASSWORD="$PG_PASSWORD"
pg_dump -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" \
  --format=custom --compress=9 --verbose \
  -f "$PG_DUMP_FILE" 2>&1

if [ $? -eq 0 ]; then
  echo "[$(date)] PostgreSQL backup completed: $(du -h "$PG_DUMP_FILE" | cut -f1)"
else
  echo "[$(date)] PostgreSQL backup FAILED!" >&2
fi

# ─── Redis Backup ─────────────────────────────────────
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"

REDIS_RDB_FILE="$BACKUP_DIR/redis/dump_${TIMESTAMP}.rdb"
echo "[$(date)] Backing up Redis: $REDIS_HOST:$REDIS_PORT"

redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --rdb "$REDIS_RDB_FILE" 2>&1

if [ $? -eq 0 ]; then
  gzip -f "$REDIS_RDB_FILE"
  echo "[$(date)] Redis backup completed: $(du -h "${REDIS_RDB_FILE}.gz" | cut -f1)"
else
  echo "[$(date)] Redis backup FAILED!" >&2
fi

# ─── Retention Cleanup ────────────────────────────────
echo "[$(date)] Cleaning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR/postgres" -name "*.sql.gz" -type f -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR/redis" -name "*.rdb.gz" -type f -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR/redis" -name "*.rdb" -type f -mtime "+$RETENTION_DAYS" -delete

echo "[$(date)] Backup complete"
