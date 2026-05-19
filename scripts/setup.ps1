param(
    [switch]$Quick
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot

Write-Host "YouTube AI Platform Setup" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan

# ─── 1. Check prerequisites ──────────────────────
Write-Host "`n[1/6] Checking prerequisites..." -ForegroundColor Yellow

$missing = @()
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += "Node.js (>=18)" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { $missing += "Docker" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $missing += "npm" }

if ($missing.Count -gt 0) {
    Write-Host "  Missing prerequisites: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "  Please install them and try again." -ForegroundColor Red
    exit 1
}

Write-Host "  Node: $(node --version)" -ForegroundColor Green
Write-Host "  npm: $(npm --version)" -ForegroundColor Green
Write-Host "  Docker: $(docker --version)" -ForegroundColor Green

# ─── 2. Install dependencies ──────────────────────
Write-Host "`n[2/6] Installing dependencies..." -ForegroundColor Yellow
Set-Location -LiteralPath $rootDir

if ($Quick) {
    npm install --ignore-scripts 2>&1 | Out-Null
} else {
    npm install
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "  npm install failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Root dependencies installed" -ForegroundColor Green

Set-Location -LiteralPath "$rootDir\api"
if ($Quick) {
    npm install --ignore-scripts 2>&1 | Out-Null
} else {
    npm install
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "  API dependencies install failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  API dependencies installed" -ForegroundColor Green

# ─── 3. Generate Prisma client ────────────────────
Write-Host "`n[3/6] Generating Prisma client..." -ForegroundColor Yellow
npx prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Prisma generate failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Prisma client generated" -ForegroundColor Green

# ─── 4. Check Docker infrastructure ───────────────
Write-Host "`n[4/6] Checking Docker infrastructure..." -ForegroundColor Yellow
$composeFile = "$rootDir\docker\docker-compose.local.yml"

$postgresRunning = docker ps --filter "name=yt-postgres" --filter "health=healthy" --format "{{.Names}}" 2>$null
$redisRunning = docker ps --filter "name=yt-redis" --filter "health=healthy" --format "{{.Names}}" 2>$null

if (-not $postgresRunning -or -not $redisRunning) {
    Write-Host "  Starting PostgreSQL and Redis..." -ForegroundColor Yellow
    docker compose -f $composeFile up -d

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Docker containers failed to start!" -ForegroundColor Red
        Write-Host "  Start them manually: docker compose -f docker/docker-compose.local.yml up -d" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "  Waiting for PostgreSQL..." -ForegroundColor Yellow
    docker wait yt-postgres 2>$null

    $timeout = 30
    $elapsed = 0
    while ($elapsed -lt $timeout) {
        $healthy = docker ps --filter "name=yt-postgres" --filter "health=healthy" --format "{{.Names}}"
        if ($healthy) { break }
        Start-Sleep -Seconds 2
        $elapsed += 2
    }
} else {
    Write-Host "  PostgreSQL and Redis already running" -ForegroundColor Green
}

Write-Host "  Docker infrastructure ready" -ForegroundColor Green

# ─── 5. Run database migrations ───────────────────
Write-Host "`n[5/6] Running database migrations..." -ForegroundColor Yellow
Set-Location -LiteralPath "$rootDir\api"

# First check if migrations have been applied
npx prisma migrate status 2>&1 | Out-Null
$statusExit = $LASTEXITCODE

if ($statusExit -eq 0) {
    Write-Host "  Migrations already applied. Checking for drift..." -ForegroundColor Yellow
    $diff = & npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma 2>&1
    if ($LASTEXITCODE -eq 0 -and -not $diff) {
        Write-Host "  No drift detected, schema is up to date" -ForegroundColor Green
    } else {
        Write-Host "  Drift detected! Creating new migration..." -ForegroundColor Yellow
        npx prisma migrate dev 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Migration creation failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "  New migration created and applied" -ForegroundColor Green
    }
} else {
    Write-Host "  No existing migrations found. Applying..." -ForegroundColor Yellow
    npx prisma migrate deploy 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  No migrations to deploy, creating initial..." -ForegroundColor Yellow
        npx prisma migrate dev --name init 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Database setup failed!" -ForegroundColor Red
            exit 1
        }
    }
}
Write-Host "  Database schema applied" -ForegroundColor Green

# ─── 6. Create required directories ───────────────
Write-Host "`n[6/6] Creating required directories..." -ForegroundColor Yellow
@("uploads", "logs", "temp") | ForEach-Object {
    $dir = "$rootDir\$_"
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  Created $_/" -ForegroundColor Green
    }
}

Write-Host "`n✅ Setup complete!" -ForegroundColor Green
Write-Host "`nQuick start:" -ForegroundColor Cyan
Write-Host "  npm run dev          - Start API + Dashboard (via Turbo)" -ForegroundColor White
Write-Host "  npm run studio       - Open Prisma Studio (DB browser)" -ForegroundColor White
Write-Host "  npm run db:up        - Start infrastructure if stopped" -ForegroundColor White
Write-Host "`nOr use the full Docker stack:" -ForegroundColor Cyan
Write-Host "  docker compose -f docker/docker-compose.yml up -d" -ForegroundColor White
