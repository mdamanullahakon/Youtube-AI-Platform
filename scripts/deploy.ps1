param(
    [switch]$Build,
    [switch]$Up,
    [switch]$Down,
    [switch]$Logs,
    [switch]$Gpu
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$composeDir = "$rootDir\docker"
$composeFile = "$composeDir\docker-compose.yml"
$gpuFile = "$composeDir\docker-compose.gpu.yml"

# Determine compose arguments
$composeArgs = @("-f", $composeFile)
if ($Gpu) {
    if (-not (Test-Path $gpuFile)) {
        Write-Host "GPU compose override not found: $gpuFile" -ForegroundColor Red
        exit 1
    }
    $composeArgs += @("-f", $gpuFile)
}

function Show-Usage {
    Write-Host "Usage: .\deploy.ps1 [-Build] [-Up] [-Down] [-Logs] [-Gpu]" -ForegroundColor Cyan
    Write-Host "  -Build    Build Docker images" -ForegroundColor Yellow
    Write-Host "  -Up       Start containers" -ForegroundColor Yellow
    Write-Host "  -Down     Stop containers" -ForegroundColor Yellow
    Write-Host "  -Logs     Show container logs" -ForegroundColor Yellow
    Write-Host "  -Gpu      Include GPU support (attaches NVIDIA GPUs to Ollama)" -ForegroundColor Yellow
}

if (-not $Build -and -not $Up -and -not $Down -and -not $Logs) {
    Show-Usage
    exit
}

Set-Location -LiteralPath $rootDir

if ($Build) {
    Write-Host "Building Docker images..." -ForegroundColor Yellow
    docker compose @composeArgs build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build complete!" -ForegroundColor Green
}

if ($Up) {
    Write-Host "Starting containers..." -ForegroundColor Yellow
    docker compose @composeArgs up -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Platform deployed!" -ForegroundColor Green
        Write-Host "  API: http://localhost:4000" -ForegroundColor White
        Write-Host "  Dashboard: http://localhost:3000" -ForegroundColor White
    } else {
        Write-Host "Failed to start containers!" -ForegroundColor Red
        exit 1
    }
}

if ($Down) {
    Write-Host "Stopping containers..." -ForegroundColor Yellow
    docker compose @composeArgs down
    Write-Host "Containers stopped!" -ForegroundColor Green
}

if ($Logs) {
    docker compose @composeArgs logs -f
}
