# YouTube AI Platform

**Autonomous AI-Powered YouTube Content Operating System**

A full production-grade platform that researches, generates, renders, optimizes, publishes, and improves YouTube content automatically using AI agents.

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
