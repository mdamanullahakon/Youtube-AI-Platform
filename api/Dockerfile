# ─────────────────────────────────────────────
# Stage 1: Build dependencies + compile
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma/ ./prisma/

RUN npm ci
RUN npx prisma generate

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: Production-only node_modules
# ─────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
COPY prisma/ ./prisma/

RUN npm ci --omit=dev && npx prisma generate

# ─────────────────────────────────────────────
# Stage 3: Runtime image
# ─────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package*.json ./

RUN mkdir -p /app/uploads/videos /app/uploads/voiceovers /app/uploads/thumbnails /app/logs

RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 4000

ENV NODE_ENV=production \
    PORT=4000 \
    FFMPEG_PATH=ffmpeg

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "dist/server.js"]
