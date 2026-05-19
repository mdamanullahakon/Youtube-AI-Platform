#!/usr/bin/env bash
# ─────────────────────────────────────────────
# YouTube AI Platform — Database Backup Script
# ─────────────────────────────────────────────
# Run via cron for automated backups:
#   0 3 * * * /opt/youtube-ai-platform/scripts/linux/backup.sh
#
# Restore:
#   cat backup.sql | docker exec -i yt-postgres psql -U postgres youtube_ai_platform
# ─────────────────────────────────────────────
set -euo pipefail

BACKUP_DIR="/opt/backups/youtube-ai-platform"
DB_CONTAINER="yt-postgres"
DB_USER="postgres"
DB_NAME="youtube_ai_platform"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
LATEST_LINK="${BACKUP_DIR}/latest.sql.gz"

log() { echo "[backup] $1"; }

log "Starting backup of ${DB_NAME}..."

# Dump and compress
docker exec "${DB_CONTAINER}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${BACKUP_FILE}"

# Update latest link
ln -sf "${BACKUP_FILE}" "${LATEST_LINK}"

log "Backup saved: ${BACKUP_FILE}"

# Cleanup old backups
find "${BACKUP_DIR}" -name "backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
log "Cleaned up backups older than ${RETENTION_DAYS} days"

# Backup size
SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "Backup size: ${SIZE}"
log "Backup complete!"
