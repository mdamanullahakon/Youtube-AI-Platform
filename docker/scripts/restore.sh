#!/bin/sh
# ──────────────────────────────────────────────────────
# YouTube AI Platform — Database Restore Script
# ──────────────────────────────────────────────────────
# Restores PostgreSQL from a custom-format pg_dump archive
# and/or Redis from an RDB backup.
#
# Usage:
#   ./docker/scripts/restore.sh postgres <backup_file>
#   ./docker/scripts/restore.sh redis <backup_file>
#
# Examples:
#   ./docker/scripts/restore.sh postgres /backup/postgres/youtube_ai_platform_20260513_120000.sql.gz
#   ./docker/scripts/restore.sh redis /backup/redis/dump_20260513_120000.rdb.gz
#
# Env vars:
#   PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE
#   REDIS_HOST, REDIS_PORT
# ──────────────────────────────────────────────────────

set -e

RESTORE_TYPE="$1"
BACKUP_FILE="$2"

if [ -z "$RESTORE_TYPE" ] || [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <postgres|redis> <backup_file>"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

case "$RESTORE_TYPE" in
  postgres)
    PG_HOST="${PG_HOST:-postgres}"
    PG_PORT="${PG_PORT:-5432}"
    PG_USER="${PG_USER:-${POSTGRES_USER:-postgres}}"
    PG_PASSWORD="${PG_PASSWORD:-${POSTGRES_PASSWORD:-postgres}}"
    PG_DATABASE="${PG_DATABASE:-${POSTGRES_DB:-youtube_ai_platform}}"

    echo "[$(date)] Restoring PostgreSQL: $PG_DATABASE@$PG_HOST:$PG_PORT"
    echo "[$(date)] Backup file: $BACKUP_FILE"

    export PGPASSWORD="$PG_PASSWORD"

    # Drop existing connections and recreate database
    psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PG_DATABASE' AND pid <> pg_backend_pid();"
    psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS $PG_DATABASE;"
    psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres \
      -c "CREATE DATABASE $PG_DATABASE;"

    # Restore from custom-format dump
    pg_restore -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" \
      --format=custom --verbose --clean --if-exists \
      "$BACKUP_FILE" 2>&1

    echo "[$(date)] PostgreSQL restore completed"
    ;;

  redis)
    REDIS_HOST="${REDIS_HOST:-redis}"
    REDIS_PORT="${REDIS_PORT:-6379}"

    echo "[$(date)] Restoring Redis: $REDIS_HOST:$REDIS_PORT"
    echo "[$(date)] Backup file: $BACKUP_FILE"

    # If gzipped, uncompress first
    if echo "$BACKUP_FILE" | grep -q '\.gz$'; then
      gunzip -k -f "$BACKUP_FILE"
      BACKUP_FILE="${BACKUP_FILE%.gz}"
    fi

    # Copy RDB to Redis data dir and restart Redis
    echo "[$(date)] To restore Redis from RDB:"
    echo "  1. Copy $BACKUP_FILE to the Redis container:"
    echo "     docker cp $BACKUP_FILE yt-redis:/data/dump.rdb"
    echo "  2. Restart Redis:"
    echo "     docker restart yt-redis"
    echo ""
    echo "[$(date)] WARNING: This will OVERWRITE current Redis data!"
    ;;

  *)
    echo "Error: Unknown type '$RESTORE_TYPE'. Use 'postgres' or 'redis'."
    exit 1
    ;;
esac
