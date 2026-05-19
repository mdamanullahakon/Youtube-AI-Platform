# Deployment Guide

## Architecture

```
                           ┌─────────────┐
                           │   Internet   │
                           └──────┬──────┘
                                  │ :80 / :443
                           ┌──────▼──────┐
                           │    Nginx    │
                           │ (Reverse Proxy)
                           └──┬──────┬──┘
                              │      │
                     ┌────────▼─┐  ┌─▼────────┐
                     │   API    │  │ Dashboard │
                     │  :4000   │  │  :3000    │
                     └┬──────┬──┘  └───────────┘
                      │      │
               ┌──────▼─┐  ┌─▼──────┐
               │Postgres│  │  Redis │
               │  :5432 │  │  :6379 │
               └────────┘  └────────┘
```

## Part A — Vercel (Frontend / Dashboard)

### Prerequisites
- Vercel account (free tier)
- GitHub repository connected to Vercel

### Steps

1. **Push dashboard to Vercel**

```bash
cd apps/dashboard
vercel --prod
```

Or connect via Vercel dashboard:
- Import your GitHub repo
- Set **Root Directory** to `apps/dashboard`
- Set **Build Command** to `npm run build`
- Set **Output Directory** to `.next`

2. **Environment Variables in Vercel**

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://api.yourdomain.com` |

3. **Set custom domain** (optional)
   - Go to Vercel Dashboard → your project → Domains
   - Add `dashboard.yourdomain.com`

4. **Vercel.json config** (create `apps/dashboard/vercel.json`):

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

---

## Part B — VPS (Backend + AI + Database)

### 1. Prerequisites

- VPS with **4GB+ RAM**, **40GB+ SSD**, **2+ vCPUs**
- Ubuntu 22.04+ or Debian 12+
- Domain name (e.g., `api.yourdomain.com`)
- Ports 80, 443 open in firewall

### 2. Initial Server Setup

```bash
# SSH in
ssh root@your-vps-ip

# Update system
apt update && apt upgrade -y
apt install -y curl wget git ufw fail2ban

# Firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Fail2ban config
cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
systemctl restart fail2ban
```

### 3. Install Docker + Docker Compose

```bash
curl -fsSL https://get.docker.com | bash
systemctl enable --now docker

# Docker compose plugin
apt install -y docker-compose-plugin
```

### 4. Install Node.js + PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash
apt install -y nodejs

# PM2 process manager
npm install -g pm2
pm2 startup systemd
```

### 5. Install PostgreSQL (bare metal, optional if using Docker)

```bash
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql

# Create database
sudo -u postgres psql -c "CREATE DATABASE youtube_ai_platform;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'your-secure-password';"
```

### 6. Install Redis (bare metal, optional if using Docker)

```bash
apt install -y redis-server
systemctl enable --now redis-server
redis-cli ping  # Should return PONG
```

### 7. Install Ollama AI Engine

```bash
curl -fsSL https://ollama.com/install.sh | bash
systemctl enable --now ollama

# Pull default model
ollama pull llama3
```

### 8. Clone & Configure

```bash
cd /opt
git clone https://github.com/your-org/youtube-ai-platform.git
cd youtube-ai-platform

cp .env.production.example .env
# Edit .env with production values
nano .env
```

### 9. Install Dependencies & Build

```bash
npm install
cd api && npm install
npx prisma generate
npm run build
pm2 start ecosystem.config.js --env production
```

### 10. Set Up Nginx Reverse Proxy

Create `/etc/nginx/sites-available/api.yourdomain.com`:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }

    location /api/health {
        access_log off;
        proxy_pass http://127.0.0.1:4000/api/health;
    }
}
```

### 11. SSL with Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.yourdomain.com

# Auto-renewal
certbot renew --dry-run
```

---

## Part C — PM2 Setup

### ecosystem.config.js (at project root)

```javascript
module.exports = {
  apps: [
    {
      name: 'yt-api',
      cwd: './api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      env_file: '.env',
      max_memory_restart: '1G',
      error_file: './logs/pm2-api-err.log',
      out_file: './logs/pm2-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: 10000,
      listen_timeout: 30000,
      kill_timeout: 10000,
      autorestart: true,
    },
    {
      name: 'yt-worker',
      cwd: './api',
      script: 'dist/workers/video.worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      env_file: '.env',
      max_memory_restart: '1G',
      error_file: './logs/pm2-worker-err.log',
      out_file: './logs/pm2-worker-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_restarts: 10,
      restart_delay: 5000,
      autorestart: true,
    },
    {
      name: 'yt-health-monitor',
      cwd: '.',
      script: 'scripts/health-monitor.js',
      args: ['--watch', '--interval=30'],
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      error_file: './logs/pm2-health-err.log',
      out_file: './logs/pm2-health-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_restarts: 5,
      autorestart: true,
    },
  ],
};
```

### PM2 Commands

```bash
pm2 start ecosystem.config.js            # Start all
pm2 restart yt-api                       # Restart single
pm2 logs yt-api                          # Live logs
pm2 status                               # All statuses
pm2 save                                 # Save process list
pm2 startup systemd                      # Auto-start on boot
pm2 monit                                # Monitor dashboard
```

---

## Part D — Database Migrations

```bash
cd api
npx prisma migrate deploy                # Apply pending migrations
npx prisma migrate status                # Check migration status
npx prisma db push                       # Push schema (dev only)
```

---

## Part E — CI/CD Pipeline

The project includes GitHub Actions workflows:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `test.yml` | PR push | Lint + TypeScript check + unit tests |
| `lint.yml` | PR push | Code quality checks |
| `docker-build.yml` | PR push | Verify Docker builds |
| `deploy.yml` | Push to main | Build → Deploy to VPS via SSH |

### Setting Up Secrets

In your GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `VPS_HOST` | Your VPS IP |
| `VPS_USERNAME` | `root` |
| `VPS_SSH_KEY` | Private SSH key |
| `DOMAIN` | `api.yourdomain.com` |

---

## Part F — Production Health Checks

### Docker Health Checks (auto-configured)

`GET /api/health` — Checks DB, Redis, memory, queue statuses
`GET /api/metrics` — Prometheus-formatted metrics

### Manual Health Commands

```bash
# API health
curl -f https://api.yourdomain.com/api/health

# Dashboard
curl -f https://dashboard.yourdomain.com

# Database
docker exec yt-postgres pg_isready -U postgres

# Redis
redis-cli ping

# Ollama
curl -f http://localhost:11434/api/tags

# PM2 processes
pm2 status
```

### Monitor Script

```bash
node scripts/health-monitor.js --watch --interval=60
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| API 502 Bad Gateway | Check PM2: `pm2 status`. Restart: `pm2 restart yt-api` |
| Database connection refused | `systemctl status postgresql` or check Docker containers |
| Redis PONG not returned | `systemctl restart redis-server` |
| Ollama not responding | `systemctl status ollama` then `journalctl -u ollama -n 50` |
| PM2 process crashes | Check logs: `pm2 logs yt-api --lines 50` |
| SSL certificate expired | `certbot renew` |
| Disk space critical | `df -h`, remove old logs: `rm -rf /opt/youtube-ai-platform/logs/*.log` |
| High memory usage | Check `pm2 monit`, consider adding swap |
| Frontend API errors | Verify `NEXT_PUBLIC_API_URL` in Vercel env vars |
| Build failures | `rm -rf node_modules dist .next && npm install && npm run build` |

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API crash due to OOM | Medium | High | PM2 auto-restart, max_memory_restart: 1G |
| Database corruption | Low | Critical | Daily backups via cron, WAL archiving |
| Redis data loss | Low | Medium | AOF persistence enabled |
| Ollama GPU OOM | Medium | Medium | Run on CPU with low-memory mode |
| SSL cert expiration | Low | High | Certbot auto-renewal + cron check |
| Queue worker deadlock | Low | High | Dead-letter queue monitoring |
| Disk full from logs | Medium | Medium | PM2 max-size rotation, weekly cleanup |
| VPS provider outage | Low | Critical | Multi-region failover (future) |

---

## Scaling Recommendations

1. **Horizontal scaling**: Add more API instances via PM2 cluster mode
2. **Database**: Upgrade to managed PostgreSQL (RDS, Cloud SQL) with read replicas
3. **Redis**: Use Redis Cluster for high availability
4. **Queue workers**: Increase concurrency per worker
5. **CDN**: Serve thumbnails/videos via Cloudflare or CDN
6. **Monitoring**: Integrate with Sentry for error tracking, Grafana for metrics
7. **Ollama**: Run on dedicated GPU instance for faster AI inference

---

## One-Click Deploy (VPS First-Time)

```bash
# On your local machine:
ssh root@your-vps-ip 'bash -s' < scripts/linux/production-setup.sh
```
