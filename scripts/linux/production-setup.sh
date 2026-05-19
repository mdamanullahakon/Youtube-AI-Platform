#!/usr/bin/env bash
# ─────────────────────────────────────────────
# YouTube AI Platform — Fresh VPS Setup Script
# ─────────────────────────────────────────────
# Run this once on a new VPS to install all
# dependencies and clone the repo.
#
# Usage:
#   wget -qO- https://raw.githubusercontent.com/your-org/youtube-ai-platform/main/scripts/linux/production-setup.sh | bash
#   # OR
#   curl -fsSL https://raw.githubusercontent.com/your-org/youtube-ai-platform/main/scripts/linux/production-setup.sh | bash
# ─────────────────────────────────────────────
set -euo pipefail

# ─── Config ─────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/your-org/youtube-ai-platform.git}"
DEPLOY_DIR="/opt/youtube-ai-platform"
NODE_VERSION="20"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[setup]${NC} $1"; }
err()  { echo -e "${RED}[setup]${NC} $1"; exit 1; }

# ─── System Requirements ────────────────────
log "Checking system requirements..."

# OS
if [ ! -f /etc/os-release ]; then
  err "Unsupported OS"
fi

. /etc/os-release
log "Detected OS: ${ID} ${VERSION_ID}"

# Architecture
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "aarch64" ]; then
  err "Unsupported architecture: ${ARCH}"
fi

# Memory
TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_MEM" -lt 1024 ]; then
  err "Insufficient memory: ${TOTAL_MEM}MB (need at least 1GB)"
fi
log "Memory: ${TOTAL_MEM}MB"

# Disk
FREE_DISK=$(df -m "${DEPLOY_DIR}" 2>/dev/null | awk 'NR==2{print $4}' || df -m / | awk 'NR==2{print $4}')
if [ "$FREE_DISK" -lt 10240 ]; then
  err "Insufficient disk space: ${FREE_DISK}MB (need at least 10GB)"
fi
log "Free disk: ${FREE_DISK}MB"

# ─── Install Dependencies ───────────────────
log "Installing system dependencies..."

apt-get update -qq
apt-get install -y -qq \
  curl \
  wget \
  git \
  openssl \
  ca-certificates \
  gnupg \
  lsb-release \
  ufw

# Docker
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker
  systemctl start docker
fi

# Docker Compose plugin
if ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Compose plugin..."
  DOCKER_CONFIG=${DOCKER_CONFIG:-/usr/local/lib/docker/cli-plugins}
  mkdir -p "${DOCKER_CONFIG}"
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o "${DOCKER_CONFIG}/docker-compose"
  chmod +x "${DOCKER_CONFIG}/docker-compose"
fi

log "Docker version: $(docker --version)"
log "Docker Compose version: $(docker compose version)"

# ─── Firewall ───────────────────────────────
log "Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
log "Firewall enabled: SSH(22), HTTP(80), HTTPS(443)"

# ─── Clone Repository ───────────────────────
if [ -d "${DEPLOY_DIR}" ]; then
  log "Repository already exists at ${DEPLOY_DIR}, pulling latest..."
  cd "${DEPLOY_DIR}"
  git pull
else
  log "Cloning repository to ${DEPLOY_DIR}..."
  git clone "${REPO_URL}" "${DEPLOY_DIR}"
  cd "${DEPLOY_DIR}"
fi

# ─── Environment ────────────────────────────
if [ ! -f "${DEPLOY_DIR}/.env.production" ]; then
  warn "No .env.production file found."
  warn "Creating from template — EDIT THIS FILE with your secrets!"
  cp "${DEPLOY_DIR}/.env.production.example" "${DEPLOY_DIR}/.env.production"
  warn "Edit ${DEPLOY_DIR}/.env.production before deploying."
fi

# ─── Create Docker Network (if not exists) ──
docker network inspect yt-network >/dev/null 2>&1 || \
  docker network create yt-network

# ─── Done ────────────────────────────────────
log "╔═══════════════════════════════════════════╗"
log "║  Setup Complete!                          ║"
log "║                                           ║"
log "║  Next steps:                              ║"
log "║  1. Edit .env.production with your keys   ║"
log "║     nano ${DEPLOY_DIR}/.env.production  ║"
log "║                                           ║"
log "║  2. Run the deploy script:                ║"
log "║     cd ${DEPLOY_DIR}                     ║"
log "║     ./scripts/linux/deploy.sh production  ║"
log "║                                           ║"
log "║  3. Set up SSL with Let's Encrypt:        ║"
log "║     docker exec yt-nginx certbot ...      ║"
log "╚═══════════════════════════════════════════╝"
