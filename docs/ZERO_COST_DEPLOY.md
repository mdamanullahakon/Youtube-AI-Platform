# Zero-Cost Deployment Guide

Run the YouTube AI Platform on a single Windows PC with **$0/month operational cost** (electricity excluded).

## Requirements

| Component | Low-End (8GB RAM) | Mid-Range (16GB RAM) |
|---|---|---|
| CPU | 4 cores | 6+ cores |
| RAM | 8 GB | 16 GB |
| Disk | 50 GB free | 100 GB free |
| GPU | Not required | Optional (4GB+ VRAM) |
| Internet | Broadband | Broadband |

## Prerequisites

1. **Docker Desktop** — [install](https://docs.docker.com/desktop/install/windows-install/)
2. **Ollama** — [install](https://ollama.com/download/windows)
3. **FFmpeg** — [install](https://ffmpeg.org/download.html) (or `winget install ffmpeg`)
4. **Node.js 20+** — [install](https://nodejs.org/)
5. **Python 3.10+** (only needed for Edge TTS)

## Quick Start

### 1. Clone & Configure

```bash
git clone <repo> youtube-ai-platform
cd youtube-ai-platform
copy api\.env.example api\.env
```

Edit `api\.env`:
- Set `JWT_SECRET` and `JWT_REFRESH_SECRET` to random strings (min 32 chars)
- Set `LOW_MEMORY_MODE=true` if you have 8GB RAM
- Leave all API keys empty (they default to free/local providers)

### 2. Pull Ollama Models

```bash
ollama pull llama3.2:3b
# Optional: also download the 7B model for better quality
ollama pull mistral:7b-instruct
```

On 8GB RAM, use only 3B models. The system auto-selects the smallest available model.

### 3. Start Infrastructure

```bash
docker compose -f docker/docker-compose.local.yml up -d
```

This starts PostgreSQL and Redis with minimal resource limits.

### 4. Install Dependencies

```bash
cd api
npm install
npx prisma migrate dev
```

### 5. Install Edge TTS (Recommended Voice)

```bash
pip install edge-tts
```

Edge TTS works offline and requires no API key.

### 6. Start API

```bash
npm run dev
```

The API starts on `http://localhost:4000`.

## Stock Footage (Optional — Free)

For video backgrounds with stock footage:

1. Get a free Pexels API key: https://www.pexels.com/api/
2. Get a free Pixabay API key: https://pixabay.com/api/docs/
3. Add to `api\.env`:
   ```
   PEXELS_API_KEY="your_key"
   PIXABAY_API_KEY="your_key"
   ```

Both are free. Pexels allows 200 req/hour, Pixabay allows 5000 req/hour.

## Background Music (Optional — Free)

Place `.mp3`/`.wav`/`.ogg` files in `./music/` directory. The system picks tracks matching the video mood:

- `upbeat` — energetic, positive
- `calm` — ambient, relaxing
- `cinematic` — orchestral, epic
- `suspense` — dark, mysterious
- `motivational` — driving, inspiring

If no music files exist, the system generates ambient tones via ffmpeg.

Recommended free music sources: [Pixabay Music](https://pixabay.com/music/), [Uppbeat](https://uppbeat.io/).

## Per-Channel Configuration

Create a video project for each channel:

```json
{
  "channelId": "channel-1",
  "topic": "tech news",
  "schedule": "daily",
  "uploadTime": "08:00"
}
```

Each channel gets its own queue namespace. The system handles up to 3 channels on a single PC.

## Daily Workflow

The system runs automatically via the scheduler service:

1. **Morning (6:00)** — Detect trends, generate ideas
2. **Afternoon (12:00)** — Generate scripts, scenes, TTS
3. **Evening (18:00)** — Render videos, upload to YouTube

No manual intervention needed after initial setup.

## RAM Optimization (8GB Systems)

Set `LOW_MEMORY_MODE=true` in `.env` to:

- Use 3B Ollama models (1.5-2GB RAM) instead of 7B (4GB+)
- Process one video at a time (no concurrent renders)
- Reduce ffmpeg preset to `ultrafast` (lower RAM, larger files)
- Limit Ollama context window to 2048 tokens
- Set DB pool min/max to 2/5
- Reduce Redis memory limit to 128MB

## Troubleshooting

**Ollama not responding** — Ensure Ollama Desktop is running (system tray). The API connects to `http://localhost:11434`.

**FFmpeg not found** — Install FFmpeg and add to PATH, or set `FFMPEG_PATH` in `.env`.

**Out of memory during render** — Enable `LOW_MEMORY_MODE=true` or reduce scene count.

**Edge TTS fails** — Install Python + `pip install edge-tts`. As fallback, the system uses ffmpeg-generated ambient audio.

## Cost Breakdown

| Service | Monthly Cost | Notes |
|---|---|---|
| Ollama (local LLM) | $0 | Fully local |
| Edge TTS (local TTS) | $0 | Python tool, no API |
| Stable Diffusion (local) | $0 | Optional GPU accelerated |
| PostgreSQL + Redis (Docker) | $0 | Self-hosted |
| Pexels (stock footage) | $0 | 16,000 requests/month |
| YouTube API | $0 | 10,000 units/day free quota |
| Pixabay API | $0 | 5,000 requests/hour |
| **Total** | **$0/month** | |

## Architecture (Single PC)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  PostgreSQL   │     │    Redis     │     │   Ollama     │
│  (Docker)     │◄───►│  (Docker)    │     │  (Native)    │
└──────────────┘     └──────────────┘     └──────────────┘
       ▲                    ▲                    ▲
       │                    │                    │
       └────────┬───────────┴────────┬──────────┘
                │                    │
        ┌───────▼──────────┐ ┌──────▼─────────┐
        │   API (Node.js)  │ │   Dashboard     │
        │   port 4000      │ │   (optional)    │
        └──────────────────┘ └─────────────────┘
```

All services on one machine. No cloud dependencies.
