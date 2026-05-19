#!/bin/sh
# ─────────────────────────────────────────────
# Ollama model initializer
# Pulls required models on first startup
# ─────────────────────────────────────────────
set -e

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
MODEL="${OLLAMA_MODEL:-llama3}"

echo "Waiting for Ollama at ${OLLAMA_HOST}..."
until ollama list >/dev/null 2>&1; do
  sleep 2
done

echo "Pulling model: ${MODEL}"
ollama pull "${MODEL}"

echo "Model ${MODEL} ready"
