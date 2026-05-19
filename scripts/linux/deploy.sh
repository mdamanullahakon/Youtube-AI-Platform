#!/usr/bin/env bash
# ─────────────────────────────────────────────
# YouTube AI Platform — Production Deploy Script
# ─────────────────────────────────────────────
# Usage:
#   ./scripts/linux/deploy.sh [environment]
#   ./scripts/linux/deploy.sh staging
#   ./scripts/linux/deploy.sh production
#
# Prerequisites:
#   - Docker & Docker Compose installed
#   - .env.[environment] file exists in project root
#   - Ports 80, 443 available
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${PROJECT_ROOT}"

# ─── Config ─────────────────────────────────
ENVIRONMENT="${1:-production}"
ENV_FILE=".env.${ENVIRONMENT}"
COMPOSE_FILE="docker/docker-compose.prod.yml"
COMPOSE_GPU="docker/docker-compose.gpu.yml"
PROJECT_NAME="yt-${ENVIRONMENT}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
err()  { echo -e "${RED}[deploy]${NC} $1"; exit 1; }

# ─── Checks ──────────────────────────────────
if [ ! -f "${ENV_FILE}" ]; then
  err "Environment file '${ENV_FILE}' not found.
  Copy .env.production.example to ${ENV_FILE} and fill in values."
fi

command -v docker >/dev/null 2>&1 || err "Docker is not installed"
command -v docker compose >/dev/null 2>&1 || err "Docker Compose is not installed"

# ─── Deploy ──────────────────────────────────
log "Deploying to ${ENVIRONMENT} environment..."
log "Using compose file: ${COMPOSE_FILE}"
log "Using env file: ${ENV_FILE}"

# Pull latest images
log "Pulling latest images..."
docker compose \
  -f "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  -p "${PROJECT_NAME}" \
  pull

# Start services
log "Starting services..."
DOCKER_COMPOSE_CMD="docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} -p ${PROJECT_NAME}"

# Check for NVIDIA GPU
if command -v nvidia-smi >/dev/null 2>&1; then
  log "NVIDIA GPU detected, enabling GPU acceleration..."
  DOCKER_COMPOSE_CMD="${DOCKER_COMPOSE_CMD} -f ${COMPOSE_GPU}"
fi

${DOCKER_COMPOSE_CMD} up -d --remove-orphans

# ─── Health Check ────────────────────────────
log "Waiting for services to be healthy..."
sleep 15

MAX_RETRIES=12
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    log "All services healthy! (HTTP ${HTTP_CODE})"
    break
  fi
  RETRY=$((RETRY + 1))
  warn "Health check attempt ${RETRY}/${MAX_RETRIES} (HTTP ${HTTP_CODE})"
  sleep 5
done

if [ $RETRY -eq $MAX_RETRIES ]; then
  warn "Health check did not return 200. Check logs:"
  ${DOCKER_COMPOSE_CMD} logs --tail=50 api
fi

# ─── Cleanup ─────────────────────────────────
log "Cleaning up old images..."
docker image prune -f

log "Deploy complete!"
log "  API:      http://localhost/api"
log "  Dashboard: http://localhost"
log "  Health:    http://localhost/api/health"

# Show status
${DOCKER_COMPOSE_CMD} ps
