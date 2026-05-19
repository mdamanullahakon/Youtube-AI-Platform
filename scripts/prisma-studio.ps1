#!/usr/bin/env pwsh
# ─────────────────────────────────────────────
# Prisma Studio Launcher
# Opens Prisma Studio (DB browser GUI).
# ─────────────────────────────────────────────
param(
    [switch]$NoBrowser
)

$rootDir = Split-Path -Parent $PSScriptRoot
$apiDir = "$rootDir\api"

# Ensure .env exists
$envFile = "$apiDir\.env"
if (-not (Test-Path $envFile)) {
    Write-Host "No .env found at $envFile" -ForegroundColor Red
    Write-Host "Copy .env.example to .env first:" -ForegroundColor Yellow
    Write-Host "  copy api\.env.example api\.env" -ForegroundColor White
    exit 1
}

# Check Docker infra
$postgresRunning = docker ps --filter "name=yt-postgres" --filter "health=healthy" --format "{{.Names}}" 2>$null
if (-not $postgresRunning) {
    Write-Host "PostgreSQL is not running!" -ForegroundColor Yellow
    Write-Host "Start it:" -ForegroundColor Yellow
    Write-Host "  docker compose -f docker/docker-compose.local.yml up -d postgres" -ForegroundColor White
    exit 1
}

Set-Location -LiteralPath $apiDir

$browserArg = if ($NoBrowser) { "--browser", "none" } else { @() }

Write-Host "Opening Prisma Studio..." -ForegroundColor Cyan
Write-Host "  URL: http://localhost:5555" -ForegroundColor White
Write-Host "  Press Ctrl+C to exit" -ForegroundColor Yellow

npx prisma studio @browserArg
