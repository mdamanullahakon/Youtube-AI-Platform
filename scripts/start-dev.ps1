param(
    [switch]$NoDashboard,
    [switch]$NoAPI,
    [switch]$SkipInfra
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot

Write-Host "Starting YouTube AI Platform (Development)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ─── 1. Ensure Docker infra is running ────────────
if (-not $SkipInfra) {
    Write-Host "`n[1/3] Checking infrastructure..." -ForegroundColor Yellow
    $composeFile = "$rootDir\docker\docker-compose.local.yml"

    $runningServices = docker compose -f $composeFile ps --services --filter "status=running" 2>$null
    $pgRunning = $runningServices -contains "postgres"
    $rdRunning = $runningServices -contains "redis"

    if (-not $pgRunning -or -not $rdRunning) {
        Write-Host "  Postgres/Redis not running. Starting..." -ForegroundColor Yellow
        docker compose -f $composeFile down 2>$null
        docker compose -f $composeFile up -d postgres redis
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Failed to start Docker containers!" -ForegroundColor Red
            Write-Host "  Start manually: docker compose -f docker/docker-compose.local.yml up -d" -ForegroundColor Yellow
            exit 1
        }
        Write-Host "  Waiting for services to be healthy..." -ForegroundColor Yellow
        $timeout = 30
        $elapsed = 0
        while ($elapsed -lt $timeout) {
            $svcs = docker compose -f $composeFile ps --services --filter "status=running" 2>$null
            $pg = $svcs -contains "postgres"
            $rd = $svcs -contains "redis"
            if ($pg -and $rd) { break }
            Start-Sleep -Seconds 2
            $elapsed += 2
        }
        if ($elapsed -ge $timeout) {
            Write-Host "  Timeout waiting for services!" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "  PostgreSQL and Redis already healthy" -ForegroundColor Green
    }
    Write-Host "  Infrastructure ready" -ForegroundColor Green
} else {
    Write-Host "`n[1/3] Skipping infrastructure check" -ForegroundColor Yellow
}

# ─── 2. Start development servers ─────────────────
Write-Host "`n[2/3] Starting development servers..." -ForegroundColor Yellow

$jobs = @()

if (-not $NoAPI) {
    Write-Host "  Starting API (port 4000)..." -ForegroundColor Yellow
    # Clean any stale .tsbuildinfo to avoid EPERM conflicts
    $tsBuildInfo = "$using:rootDir\api\tsconfig.tsbuildinfo"
    if (Test-Path $tsBuildInfo) { Remove-Item -Force $tsBuildInfo -ErrorAction SilentlyContinue }
    $apiJob = Start-Job -ScriptBlock {
        Set-Location -LiteralPath "$using:rootDir\api"
        # Retry up to 3 times if EPERM occurs (Next.js Windows filesystem lock)
        $maxRetries = 3
        $retryDelay = 2
        for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
            try { npm run dev; break }
            catch {
                if ($attempt -lt $maxRetries) {
                    Write-Host "  API server failed (attempt $attempt/$maxRetries), retrying in ${retryDelay}s..." -ForegroundColor Yellow
                    Start-Sleep -Seconds $retryDelay
                    $retryDelay *= 2
                } else {
                    Write-Host "  API server failed after $maxRetries attempts" -ForegroundColor Red
                }
            }
        }
    }
    $jobs += @{ Name = "API"; Job = $apiJob }
}

if (-not $NoDashboard) {
    Write-Host "  Starting Dashboard (port 3001)..." -ForegroundColor Yellow
    # Clean .next cache to prevent EPERM/build errors
    $nextCache = "$using:rootDir\apps\dashboard\.next"
    if (Test-Path $nextCache) {
        Remove-Item -Recurse -Force $nextCache -ErrorAction SilentlyContinue
        Write-Host "  Cleaned .next cache" -ForegroundColor Gray
    }
    $dashJob = Start-Job -ScriptBlock {
        Set-Location -LiteralPath "$using:rootDir\apps\dashboard"
        $maxRetries = 3
        $retryDelay = 2
        for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
            try { npm run dev; break }
            catch {
                if ($attempt -lt $maxRetries) {
                    Write-Host "  Dashboard failed (attempt $attempt/$maxRetries), retrying in ${retryDelay}s..." -ForegroundColor Yellow
                    Start-Sleep -Seconds $retryDelay
                    $retryDelay *= 2
                } else {
                    Write-Host "  Dashboard failed after $maxRetries attempts" -ForegroundColor Red
                }
            }
        }
    }
    $jobs += @{ Name = "Dashboard"; Job = $dashJob }
}

Write-Host "`n[3/3] Waiting for services..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Check if API started
if (-not $NoAPI) {
    try {
        $health = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -UseBasicParsing -TimeoutSec 5
        Write-Host "  API: http://localhost:4000 (healthy)" -ForegroundColor Green
    } catch {
        Write-Host "  API: http://localhost:4000 (starting...)" -ForegroundColor Yellow
    }
}

if (-not $NoDashboard) {
    Start-Sleep -Seconds 5
    try {
        $dash = Invoke-WebRequest -Uri "http://localhost:3001" -UseBasicParsing -TimeoutSec 5
        Write-Host "  Dashboard: http://localhost:3001 (ready)" -ForegroundColor Green
    } catch {
        Write-Host "  Dashboard: http://localhost:3001 (starting...)" -ForegroundColor Yellow
    }
}

Write-Host "`n✅ Development environment running!" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop all servers" -ForegroundColor Cyan

# ─── 3. Monitor jobs ──────────────────────────────
try {
    while ($true) {
        $allFailed = $true
        foreach ($entry in $jobs) {
            if ($entry.Job.State -eq 'Failed') {
                Write-Host "❌ $($entry.Name) server failed!" -ForegroundColor Red
                Receive-Job $entry.Job -ErrorAction SilentlyContinue
            }
            if ($entry.Job.State -ne 'Failed') {
                $allFailed = $false
            }
        }
        if ($allFailed) { break }
        Start-Sleep -Seconds 2
    }
}
finally {
    Write-Host "`nStopping servers..." -ForegroundColor Yellow
    foreach ($entry in $jobs) {
        if ($entry.Job.State -eq 'Running') {
            Stop-Job $entry.Job -ErrorAction SilentlyContinue
            Remove-Job $entry.Job -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Servers stopped" -ForegroundColor Green
}
