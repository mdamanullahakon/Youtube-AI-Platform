#!/usr/bin/env pwsh
# ─────────────────────────────────────────────
# Database Management Script
# Manage PostgreSQL + Redis via Docker and Prisma.
#
# Usage:
#   .\scripts\db.ps1 <command>
#
# Commands:
#   up          - Start PostgreSQL + Redis
#   down        - Stop PostgreSQL + Redis
#   reset       - Stop, delete volumes, restart fresh
#   migrate     - Run Prisma migrations (migrate dev)
#   deploy      - Run Prisma migrations (migrate deploy - for CI/prod)
#   studio      - Open Prisma Studio (DB browser)
#   status      - Check container + migration status
#   logs        - Show Docker logs
#   psql        - Open PostgreSQL CLI
#   redis-cli   - Open Redis CLI
# ─────────────────────────────────────────────

param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'down', 'reset', 'migrate', 'deploy', 'studio', 'drift', 'status', 'logs', 'psql', 'redis-cli', help)]
    [string]$Command = 'help'
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$composeFile = "$rootDir\docker\docker-compose.local.yml"
$apiDir = "$rootDir\api"

function Write-Step($msg) { Write-Host "$msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  $msg" -ForegroundColor Red }

function Ensure-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Fail "Docker is not installed!"
        exit 1
    }
}

function Wait-Healthy {
    param($Name, $Timeout = 30)
    $elapsed = 0
    while ($elapsed -lt $Timeout) {
        $healthy = docker ps --filter "name=$Name" --filter "health=healthy" --format "{{.Names}}"
        if ($healthy) { return $true }
        Start-Sleep -Seconds 2
        $elapsed += 2
    }
    return $false
}

# ─── Commands ──────────────────────────────────────

switch ($Command) {
    'up' {
        Ensure-Docker
        Write-Step "Starting PostgreSQL + Redis..."
        docker compose -f $composeFile up -d
        Write-Step "Waiting for services..."
        $pgOk = Wait-Healthy -Name "yt-postgres" -Timeout 30
        $rdOk = Wait-Healthy -Name "yt-redis" -Timeout 15
        if ($pgOk) { Write-Ok "PostgreSQL healthy (port 5432)" } else { Write-Warn "PostgreSQL not healthy yet" }
        if ($rdOk) { Write-Ok "Redis healthy (port 6379)" } else { Write-Warn "Redis not healthy yet" }
        if ($pgOk -and $rdOk) { Write-Ok "All services ready!" } else { Write-Warn "Some services not healthy" }
    }

    'down' {
        Ensure-Docker
        Write-Step "Stopping PostgreSQL + Redis..."
        docker compose -f $composeFile down
        Write-Ok "Services stopped"
    }

    'reset' {
        Ensure-Docker
        Write-Step "Resetting database (WARNING: deletes all data)..." -ForegroundColor Red
        $confirm = Read-Host "  Are you sure? Type 'yes' to confirm"
        if ($confirm -ne 'yes') {
            Write-Warn "Reset cancelled"
            exit
        }
        docker compose -f $composeFile down -v
        Write-Ok "Volumes deleted"
        docker compose -f $composeFile up -d
        Write-Step "Waiting for PostgreSQL..."
        $ok = Wait-Healthy -Name "yt-postgres" -Timeout 30
        if ($ok) {
            Write-Ok "PostgreSQL ready"
            Write-Step "Applying migrations..."
            Set-Location -LiteralPath $apiDir
            npx prisma migrate dev
        } else {
            Write-Fail "PostgreSQL failed to start"
            exit 1
        }
    }

    'migrate' {
        Ensure-Docker
        $healthy = docker ps --filter "name=yt-postgres" --filter "health=healthy" --format "{{.Names}}"
        if (-not $healthy) {
            Write-Fail "PostgreSQL is not running. Start it: .\scripts\db.ps1 up"
            exit 1
        }
        Write-Step "Running Prisma migrations..."
        Set-Location -LiteralPath $apiDir
        npx prisma generate
        npx prisma migrate dev
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Migrations applied successfully"
        } else {
            Write-Fail "Migration failed"
            exit 1
        }
    }

    'deploy' {
        Ensure-Docker
        $healthy = docker ps --filter "name=yt-postgres" --filter "health=healthy" --format "{{.Names}}"
        if (-not $healthy) {
            Write-Fail "PostgreSQL is not running"
            exit 1
        }
        Write-Step "Deploying migrations (CI/prod mode)..."
        Set-Location -LiteralPath $apiDir
        npx prisma generate
        npx prisma migrate deploy
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Migrations deployed"
        } else {
            Write-Fail "Migration deploy failed"
            exit 1
        }
    }

    'studio' {
        Ensure-Docker
        $healthy = docker ps --filter "name=yt-postgres" --filter "health=healthy" --format "{{.Names}}"
        if (-not $healthy) {
            Write-Fail "PostgreSQL is not running. Start it: .\scripts\db.ps1 up"
            exit 1
        }
        Write-Step "Opening Prisma Studio at http://localhost:5555..."
        Set-Location -LiteralPath $apiDir
        npx prisma studio
    }

    'drift' {
        Ensure-Docker
        Write-Step "Checking migration drift..."
        Set-Location -LiteralPath $apiDir
        $diff = & npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma 2>&1
        if ($LASTEXITCODE -eq 0 -and -not $diff) {
            Write-Ok "No drift detected — schema and migrations are in sync"
        } else {
            Write-Warn "Drift detected!"
            $diff | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
            Write-Warn "Run '.\scripts\db.ps1 migrate' to create a new migration"
        }
    }

    'status' {
        Ensure-Docker
        Write-Step "Infrastructure status:"
        docker ps --filter "name=yt-postgres" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>$null
        docker ps --filter "name=yt-redis" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>$null

        Write-Step "`nMigration status:"
        Set-Location -LiteralPath $apiDir
        npx prisma migrate status 2>$null
    }

    'logs' {
        Ensure-Docker
        docker compose -f $composeFile logs -f
    }

    'psql' {
        Ensure-Docker
        $healthy = docker ps --filter "name=yt-postgres" --filter "health=healthy" --format "{{.Names}}"
        if (-not $healthy) {
            Write-Fail "PostgreSQL is not running"
            exit 1
        }
        docker exec -it yt-postgres psql -U postgres -d youtube_ai_platform
    }

    'redis-cli' {
        Ensure-Docker
        $healthy = docker ps --filter "name=yt-redis" --filter "health=healthy" --format "{{.Names}}"
        if (-not $healthy) {
            Write-Fail "Redis is not running"
            exit 1
        }
        docker exec -it yt-redis redis-cli
    }

    'help' {
        Write-Host "Database Management Script" -ForegroundColor Cyan
        Write-Host "===========================" -ForegroundColor Cyan
        Write-Host "Usage: .\scripts\db.ps1 <command>" -ForegroundColor White
        Write-Host ""
        Write-Host "Commands:" -ForegroundColor Yellow
        Write-Host "  up         Start PostgreSQL + Redis" -ForegroundColor White
        Write-Host "  down       Stop PostgreSQL + Redis" -ForegroundColor White
        Write-Host "  reset      Stop, delete volumes, restart fresh" -ForegroundColor White
        Write-Host "  migrate    Run Prisma migrations" -ForegroundColor White
        Write-Host "  deploy     Deploy migrations (CI/prod)" -ForegroundColor White
        Write-Host "  studio     Open Prisma Studio" -ForegroundColor White
        Write-Host "  drift      Check for schema vs migration drift" -ForegroundColor White
        Write-Host "  status     Check container + migration status" -ForegroundColor White
        Write-Host "  logs       Show Docker logs" -ForegroundColor White
        Write-Host "  psql       Open PostgreSQL CLI" -ForegroundColor White
        Write-Host "  redis-cli  Open Redis CLI" -ForegroundColor White
    }
}
