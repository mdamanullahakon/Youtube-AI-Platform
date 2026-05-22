# YouTube AI Platform

[![CI](https://github.com/mdamanullahakon/Youtube-AI-Platform/actions/workflows/ci.yml/badge.svg)](https://github.com/mdamanullahakon/Youtube-AI-Platform/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/mdamanullahakon/Youtube-AI-Platform/graph/badge.svg)](https://codecov.io/gh/mdamanullahakon/Youtube-AI-Platform)
[![Test Status](https://img.shields.io/badge/tests-passing-brightgreen?style=flat-square)](https://github.com/mdamanullahakon/Youtube-AI-Platform/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> **Coverage badge** — The badge above is served by Codecov and updates automatically with every CI run.

**Autonomous AI-Powered YouTube Content Operating System**

A full production-grade platform that researches, generates, renders, optimizes, publishes, and improves YouTube content automatically using AI agents.

> **Coverage report** is automatically uploaded to [Codecov](https://codecov.io/gh/mdamanullahakon/Youtube-AI-Platform) on every CI run, with PR comments when coverage changes. Coverage artifacts are also available from the [CI workflow run](https://github.com/mdamanullahakon/Youtube-AI-Platform/actions/workflows/ci.yml).

### Codecov Integration

This project uses [Codecov](https://about.codecov.io/) for automated coverage tracking, trend visualization, and PR commenting.

Merged coverage from all workspaces (API + Dashboard) is uploaded via the CI pipeline.

#### One-time Setup

1. **Enable the repo** at [app.codecov.io](https://app.codecov.io) (sign in with GitHub)
2. Codecov will automatically add `CODECOV_TOKEN` to your repo secrets, or you can add it manually:
   - Go to **Settings → Secrets and variables → Actions**
   - Add `CODECOV_TOKEN` with the token from your Codecov repo settings page
3. PR comments and status checks will appear automatically on the next CI run

#### Coverage Configuration

Coverage behavior is configured in [`codecov.yml`](./codecov.yml):
- **Components**: Tracks coverage separately for `api/src/` and `apps/dashboard/`
- **Project threshold**: Coverage can drop up to 2% before failing the check
- **Patch threshold**: New/changed code must maintain at least 10% of the base coverage
- **PR comments**: Shows a summary diff with component breakdown

## Features

- 🤖 **8 Autonomous AI Agents** - Trend research, script writing, visual prompts, voiceover, thumbnails, SEO, analytics, and upload
- 🔬 **Multi-Source Trend Analysis** - YouTube, Reddit, Google Trends
- ✍️ **Viral Script Generation** - Curiosity hooks, retention loops, emotional storytelling
- 🎨 **AI Visual Prompts** - Runway, Midjourney, Stable Diffusion, Flux
- 🎙️ **Realistic Voiceovers** - ElevenLabs integration with emotion tones
- 🖼️ **High-CTR Thumbnails** - DALL-E / Stable Diffusion generation
- 📈 **SEO Optimization** - Titles, descriptions, tags, hashtags
- 📤 **Auto Upload** - YouTube API integration with scheduling
- 📊 **Analytics Learning** - Self-improving agents based on performance

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [PostgreSQL](https://www.postgresql.org/) 16+
- [Redis](https://redis.io/) 7+
- [Ollama](https://ollama.ai/) with LLaMA 3 (or API keys for OpenAI/Claude/Gemini)
- [FFmpeg](https://ffmpeg.org/) (for video rendering)

### Setup

```bash
# Clone and install
git clone <repo>
cd youtube-ai-platform
npm install
cd api && npm install && cd ../apps/dashboard && npm install && cd ../..

# Setup database
cd api
npx prisma generate
npx prisma db push
cd ..

# Start development
.\scripts\start-dev.ps1
```

Or with Docker:

```bash
docker-compose -f docker/docker-compose.yml up -d
```

## Project Structure

```
youtube-ai-platform/
├── api/                    # Express.js backend
│   ├── src/
│   │   ├── agents/         # AI agents
│   │   ├── config/         # DB, Redis, env config
│   │   ├── controllers/    # Route handlers
│   │   ├── middleware/     # Auth, validation, rate limiting
│   │   ├── queues/         # BullMQ queues
│   │   ├── routes/         # Express routes
│   │   ├── services/       # AI, YouTube, render services
│   │   ├── utils/          # Helpers, logger
│   │   ├── workers/        # BullMQ workers
│   │   └── server.ts       # Entry point
│   └── prisma/             # Database schema & migrations
├── apps/
│   └── dashboard/          # Next.js frontend
├── docker/                 # Docker configs
├── docs/                   # Documentation
└── scripts/                # Setup & deployment scripts
```

## AI Model Support

| Model | Provider | Default |
|-------|----------|---------|
| LLaMA 3 | Ollama (local) | ✅ Default |
| GPT-4 | OpenAI | Optional |
| Claude 3 | Anthropic | Optional |
| Gemini Pro | Google | Optional |

## Deployment

### Production (Docker)

```bash
docker-compose -f docker/docker-compose.yml up -d --build
```

### VPS/Railway

1. Set environment variables (see `.env.example`)
2. Build: `npm run build`
3. Start: `npm start` in api/ and `npm start` in apps/dashboard/

## License

MIT
