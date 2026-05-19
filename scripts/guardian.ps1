param(
    [string]$ApiUrl = "http://localhost:4000",
    [int]$CheckIntervalSeconds = 15,
    [int]$StartupTimeoutSeconds = 60,
    [switch]$Daemon
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $rootDir "api"
$logDir = Join-Path $rootDir "logs"
$logFile = Join-Path $logDir "guardian.log"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log($level, $msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$ts [GUARDIAN][$level] $msg"
    Add-Content -Path $logFile -Value $line
    $colors = @{INFO = "Cyan"; OK = "Green"; WARN = "Yellow"; ERROR = "Red"}
    $c = $colors[$level]
    if (-not $c) { $c = "Gray" }
    Write-Host $line -ForegroundColor $c
}

function Test-ApiHealth {
    try {
        $response = Invoke-WebRequest -Uri "$ApiUrl/health" -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Start-Api {
    Write-Log "INFO" "Starting API server..."
    try {
        $staleProcs = netstat -ano | Select-String ":4000" | Select-String "LISTENING"
        foreach ($line in $staleProcs) {
            $pid = ($line -split '\s+') | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1
            if ($pid) {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Log "INFO" "Killed stale PID $pid on port 4000"
            }
        }
        Start-Sleep -Seconds 1

        $outFile = Join-Path $logDir "guardian-api-out.log"
        $errFile = Join-Path $logDir "guardian-api-err.log"
        $startInfo = @{
            FilePath = "npx.cmd"
            ArgumentList = @("nodemon", "-r", "dotenv/config", "src/server.ts")
            WorkingDirectory = $apiDir
            RedirectStandardOutput = $outFile
            RedirectStandardError = $errFile
            PassThru = $true
            WindowStyle = "Hidden"
        }
        $proc = Start-Process @startInfo
        Write-Log "INFO" "API process started (PID $($proc.Id))"

        $waited = 0
        while ($waited -lt $StartupTimeoutSeconds) {
            if (Test-ApiHealth) {
                Write-Log "OK" "API is healthy after ${waited}s"
                return $true
            }
            Start-Sleep -Seconds 2
            $waited += 2
        }
        Write-Log "ERROR" "API failed to start within ${StartupTimeoutSeconds}s"
        return $false
    } catch {
        Write-Log "ERROR" "Failed to start API: $($_.Exception.Message)"
        return $false
    }
}

function Test-And-Recover {
    $healthy = Test-ApiHealth
    if (-not $healthy) {
        Write-Log "WARN" "API health check FAILED — initiating recovery"
        return Start-Api
    }
    return $true
}

# ─── Main ─────────────────────────────
if ($Daemon) {
    Write-Log "INFO" "Guardian daemon started (PID $pid, check every ${CheckIntervalSeconds}s)"
    while ($true) {
        [void](Test-And-Recover)
        Start-Sleep -Seconds $CheckIntervalSeconds
    }
} else {
    Write-Log "INFO" "Running single health check..."
    $ok = Test-ApiHealth
    if ($ok) {
        Write-Log "OK" "API is healthy"
        exit 0
    } else {
        Write-Log "ERROR" "API is DOWN"
        if ($Restart -or $env:AUTO_RECOVER) {
            Write-Log "INFO" "Auto-recovery enabled — restarting API"
            $recovered = Start-Api
            if ($recovered) { exit 0 } else { exit 2 }
        }
        exit 1
    }
}
