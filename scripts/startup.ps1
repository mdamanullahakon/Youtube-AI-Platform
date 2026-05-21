param(
  [switch]$SkipBuild,
  [switch]$SkipApi,
  [switch]$Force
)

$ErrorActionPreference = "Continue"
$global:Step = 0
$global:Errors = @()
$global:DockerOk = $false
$global:RedisOk = $false
$global:PostgresOk = $false

function Step {
  param([string]$Title)
  $global:Step++
  Write-Host "`n--- [$($global:Step)] $Title ---" -ForegroundColor Cyan
}

function Log {
  param([string]$Msg, [string]$Color = "White")
  $ts = Get-Date -Format "HH:mm:ss"
  Write-Host "[$ts] $Msg" -ForegroundColor $Color
}

function Ok {
  param([string]$Msg) Log "[OK] $Msg" -Color Green
}

function Warn {
  param([string]$Msg) Log "[WARN] $Msg" -Color Yellow; $global:Errors += $Msg
}

function Fail {
  param([string]$Msg) Log "[FAIL] $Msg" -Color Red; $global:Errors += $Msg
}

function DockerReady {
  try { $null = docker ps -q 2>&1; return $true } catch { return $false }
}

function WaitForDocker {
  param([int]$TimeoutSec = 60)
  $elapsed = 0
  while ($elapsed -lt $TimeoutSec) {
    if (DockerReady) { return $true }
    Start-Sleep -Seconds 3
    $elapsed += 3
  }
  return $false
}

# ===== DOCKER HEALTH CHECK ========================
Step "DOCKER DAEMON HEALTH CHECK"

if (DockerReady) {
  Ok "Docker daemon is responsive"
} else {
  Warn "Docker daemon not responding -- attempting auto-recovery"

  # Attempt 1: Start Docker Desktop
  Log "Attempt 1/3: Starting Docker Desktop..."
  try { Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue } catch {}
  try { Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue } catch {}

  if (WaitForDocker -TimeoutSec 60) { Ok "Docker started" }
  else {
    # Attempt 2: Restart WSL
    Warn "Attempt 2/3: Restarting WSL..."
    wsl --shutdown 2>&1 | Out-Null
    Start-Sleep -Seconds 5
    try { Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue } catch {}
    try { Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue } catch {}

    if (WaitForDocker -TimeoutSec 90) { Ok "Docker recovered after WSL restart" }
    else {
      # Attempt 3: Force restart Docker service
      Warn "Attempt 3/3: Force restarting Docker service..."
      try { Stop-Service -Name "com.docker.service" -Force -ErrorAction SilentlyContinue } catch {}
      Start-Sleep -Seconds 3
      try { Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue } catch {}
      try { Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue } catch {}

      if (WaitForDocker -TimeoutSec 120) { Ok "Docker recovered after service restart" }
      else { Fail "Docker unreachable after all recovery attempts" }
    }
  }
}

if (-not (DockerReady)) {
  Fail "Cannot continue without Docker"
  exit 1
}
$global:DockerOk = $true

# ===== STOP OLD REDIS SERVICE ======================
Step "STOP LEGACY REDIS SERVICE"

$oldRedisPid = $null
try {
  $dockerRedisPid = docker inspect yt-redis --format '{{.State.Pid}}' 2>$null
  $oldRedisPid = (Get-Process -Name "redis-server" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $dockerRedisPid }).Id
} catch {}
if ($oldRedisPid) {
  Warn "Old Redis process detected (PID $oldRedisPid). Attempting to stop..."
  try { taskkill /F /PID $oldRedisPid 2>&1 | Out-Null; Ok "Old Redis stopped" } catch { Warn "Could not stop old Redis (admin may be required)" }
} else {
  Ok "No legacy Redis process detected"
}

# ===== VALIDATE DOCKER-COMPOSE FILES ===============
Step "VALIDATE COMPOSE FILES"

$composePriority = @(
  "docker/docker-compose.local.yml",
  "docker/docker-compose.yml",
  "docker-compose.yml"
)
$composeFile = $null
foreach ($f in $composePriority) {
  if (Test-Path $f) { $composeFile = $f; break }
}
if (-not $composeFile) { Fail "No docker-compose.yml found"; exit 1 }
Ok "Using compose file: $composeFile"

try {
  $null = docker compose -f $composeFile config 2>&1
  Ok "Compose file syntax valid"
} catch {
  $result = docker compose -f $composeFile config 2>&1
  if ($LASTEXITCODE -ne 0) { Warn "Compose config has warnings (non-fatal)" }
}

# ===== CLEAN CONFLICTING CONTAINERS ================
Step "CLEAN CONFLICTING CONTAINERS"

$containersToRemove = @("yt-redis", "yt-postgres")
foreach ($c in $containersToRemove) {
  try {
    $exists = docker ps -a --filter "name=^/${c}$" --format "{{.Names}}" 2>&1
    if ($exists) { docker rm -f $c 2>&1 | Out-Null; Ok "Removed container: $c" }
    else { Ok "Container $c does not exist -- skipping" }
  } catch { Warn "Could not remove $c" }
}

# ===== PRUNE STALE RESOURCES =======================
Step "PRUNE STALE RESOURCES (OPTIONAL)"

try {
  $pruneOutput = docker system prune -f --volumes 2>&1
  Ok "Pruned unused Docker resources"
} catch { Warn "Prune skipped (non-critical)" }

# ===== START INFRASTRUCTURE ========================
Step "START INFRASTRUCTURE"

Log "Starting services via docker-compose..."
$composeOutput = docker compose -f $composeFile up -d 2>&1 | Out-String
$composeOutput.Trim() -split "`n" | ForEach-Object { if ($_.Trim().Length -gt 0) { Log "  -> $_" -Color Gray } }
Start-Sleep -Seconds 15

$svcNames = @("yt-redis", "yt-postgres")
$svcLabels = @{ "yt-redis" = "Redis"; "yt-postgres" = "Postgres" }

foreach ($name in $svcNames) {
  $label = $svcLabels[$name]
  $running = docker ps --filter "name=^/${name}$" --filter "status=running" --format "{{.Names}}" 2>&1 | Out-String
  if ($running.Trim() -eq $name) {
    Ok "$label container is running"
    if ($name -eq "yt-redis") { $global:RedisOk = $true }
    if ($name -eq "yt-postgres") { $global:PostgresOk = $true }
  } else {
    Warn "$label container not running -- attempting restart..."
    try {
      docker compose -f $composeFile up -d $name 2>&1 | Out-Null
      Start-Sleep -Seconds 10
      $retry = docker ps --filter "name=^/${name}$" --filter "status=running" --format "{{.Names}}" 2>&1 | Out-String
      if ($retry.Trim() -eq $name) {
        Ok "$label restarted successfully"
        if ($name -eq "yt-redis") { $global:RedisOk = $true }
        if ($name -eq "yt-postgres") { $global:PostgresOk = $true }
      } else { Fail "$label failed to start" }
    } catch { Fail "$label restart failed: $_" }
  }
}

# ===== HEALTH CHECK ================================
Step "SERVICE HEALTH CHECK"

try {
  $redisPing = docker exec yt-redis redis-cli ping 2>&1
  if ($redisPing -match "PONG") { Ok "Redis responds to PING" }
  else { Warn "Redis PING returned unexpected: $redisPing" }
} catch { Warn "Redis PING check failed: $_" }

try {
  $pgHealth = docker exec yt-postgres pg_isready -U postgres 2>&1
  if ($pgHealth -match "accepting connections") { Ok "Postgres accepting connections" }
  else { Warn "Postgres health: $pgHealth" }
} catch { Warn "Postgres health check failed: $_" }

# ===== FINAL STATUS ================================
$border = "=========================================================="
Write-Host "`n$border" -ForegroundColor Cyan
Write-Host "              FINAL STATUS REPORT" -ForegroundColor Cyan
Write-Host "$border" -ForegroundColor Cyan

if ($global:DockerOk) { Write-Host "  [OK] Docker    : RUNNING" -ForegroundColor Green }
else { Write-Host "  [FAIL] Docker  : FAILED" -ForegroundColor Red }

if ($global:RedisOk) { Write-Host "  [OK] Redis     : RUNNING" -ForegroundColor Green }
else { Write-Host "  [FAIL] Redis   : FAILED" -ForegroundColor Red }

if ($global:PostgresOk) { Write-Host "  [OK] Postgres  : RUNNING" -ForegroundColor Green }
else { Write-Host "  [FAIL] Postgres: FAILED" -ForegroundColor Red }

if ($global:Errors.Count -gt 0) {
  Write-Host "`n  [WARN] Issues ($($global:Errors.Count)):" -ForegroundColor Yellow
  $global:Errors | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
} else {
  Write-Host "`n  [OK] All systems nominal - zero errors" -ForegroundColor Green
}
Write-Host "$border" -ForegroundColor Cyan
Write-Host ""
