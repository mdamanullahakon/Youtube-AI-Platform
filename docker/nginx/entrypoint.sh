#!/bin/sh
# ─────────────────────────────────────────────
# Nginx entrypoint — generates self-signed cert
# if no certs are mounted, then starts nginx
# ─────────────────────────────────────────────
set -e

CERT_DIR="/etc/nginx/certs"
CERT_FILE="${CERT_DIR}/cert.pem"
KEY_FILE="${CERT_DIR}/key.pem"

# Generate self-signed cert if not provided
if [ ! -f "${CERT_FILE}" ] || [ ! -f "${KEY_FILE}" ]; then
    echo "No SSL certificates found. Generating self-signed certificate..."
    mkdir -p "${CERT_DIR}"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "${KEY_FILE}" \
        -out "${CERT_FILE}" \
        -subj "/C=US/ST=State/L=City/O=YouTubeAI/CN=localhost" 2>/dev/null
    echo "Self-signed certificate generated."
fi

# Substitute environment variables in nginx config
export DOMAIN="${DOMAIN:-localhost}"
envsubst '${DOMAIN}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

echo "Starting nginx..."
exec nginx -g 'daemon off;'
