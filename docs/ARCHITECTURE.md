# YouTube AI Platform Architecture

## System Overview

```
User → Dashboard → API → Agents → Queue System → Workers → YouTube
                    ↓         ↓
                 Database   AI Models (Ollama/OpenAI/Claude/Gemini)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TailwindCSS 4, Zustand, Recharts |
| Backend | Node.js, Express.js, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| Queue | Redis, BullMQ |
| AI | Ollama, OpenAI, Claude, Gemini |
| Voice | ElevenLabs |
| Video | FFmpeg |
| Container | Docker, Docker Compose |

## Agent Pipeline

1. **Trend Research Agent** → Analyzes YouTube, Reddit, Google Trends
2. **Script Writer Agent** → Generates viral scripts with hooks
3. **Visual Prompt Agent** → Creates AI image/video prompts
4. **Voiceover Agent** → Generates realistic narration
5. **Thumbnail Agent** → Creates high-CTR thumbnails
6. **SEO Agent** → Optimizes titles, descriptions, tags
7. **Analytics Agent** → Learns from performance data

## Queue System

- `trend-analysis` - Trend research jobs
- `script-generation` - Script writing jobs
- `video-generation` - Full pipeline jobs
- `video-render` - FFmpeg rendering jobs
- `youtube-upload` - YouTube API upload jobs
- `analytics-collection` - Analytics gathering jobs

## API Endpoints

| Route | Description |
|-------|-------------|
| `/api/auth` | Register, login, profile |
| `/api/trends` | Trend analysis |
| `/api/scripts` | Script generation |
| `/api/videos` | Video pipeline & render |
| `/api/upload` | YouTube upload |
| `/api/analytics` | Dashboard & analytics |
