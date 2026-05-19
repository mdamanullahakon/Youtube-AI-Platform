param(
    [int]$Port = 4000,
    [int]$TimeoutSeconds = 30,
    [int]$RetryIntervalSeconds = 3,
    [switch]$Restart,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $rootDir "api"
$healthUrl = "http://localhost:$Port/api/health"
$logDirRoot = Join-Path $rootDir "logs"
$logFile = Join-Path $logDirRoot "check-api.log"

if (-not (Test-Path $logDirRoot)) {
    New-Item -ItemType Directory -Path $logDirRoot -Force | Out-Null
}

function Write-Log($level, $msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$ts [$level] $msg"
    Add-Content -Path $logFile -Value $line
    if (-not $Quiet) {
        $colors = @{INFO = "Cyan"; OK = "Green"; WARN = "Yellow"; ERROR = "Red"; FATAL = "Red"}
        $c = $colors[$level]
        if (-not $c) { $c = "Gray" }
        Write-Host $line -ForegroundColor $c
    }
}

# ─── Wait for API ──────────────────────────────
$elapsed = 0
$ready = $false

Write-Log "INFO" "Waiting for API at $healthUrl (timeout: ${TimeoutSeconds}s)..."

while ($elapsed -lt $TimeoutSeconds) {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            Write-Log "OK" "API is healthy (status $($response.StatusCode))"
            $ready = $true
            break
        }
    } catch {
        # Not ready yet
    }
    Start-Sleep -Seconds $RetryIntervalSeconds
    $elapsed += $RetryIntervalSeconds
}

if ($ready) {
    Write-Log "OK" "API is reachable at http://localhost:$Port"
    exit 0
}

# ─── Failed — log reason and optionally restart ─
Write-Log "ERROR" "API not reachable at $healthUrl after ${TimeoutSeconds}s"

try {
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue
    $onPort = @()
    foreach ($p in $processes) {
        $netstatLine = netstat -ano 2>$null | Select-String ":$Port" | Select-String "LISTENING"
        if ($netstatLine -and $netstatLine -match $p.Id) {
            $onPort += $p.Id
        }
    }
    if ($onPort.Count -gt 0) {
        Write-Log "WARN" "Found stale Node process(es) on port ${Port}: $($onPort -join ', ')"
    } else {
        Write-Log "WARN" "No Node process listening on port $Port"
    }
} catch {
    Write-Log "WARN" "Could not inspect port $Port"
}

if ($Restart) {
    Write-Log "INFO" "Attempting auto-restart..."
    try {
        # Kill stale processes on the port
        $procs = netstat -ano | Select-String ":$Port" | Select-String "LISTENING"
        foreach ($line in $procs) {
            $pid = ($line -split '\s+') | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1
            if ($pid) {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Log "INFO" "Killed PID $pid on port ${Port}"
            }
        }
        Start-Sleep -Seconds 2

        # Restart API
        $logDir = Join-Path $rootDir "logs"
        $outFile = Join-Path $logDir "api-restart-out.log"
        $errFile = Join-Path $logDir "api-restart-err.log"
        $startInfo = @{
            FilePath = "node.exe"
            ArgumentList = @("-r", "dotenv/config", "dist/server.js")
            WorkingDirectory = $apiDir
            RedirectStandardOutput = $outFile
            RedirectStandardError = $errFile
            PassThru = $true
            WindowStyle = "Hidden"
        }
        $proc = Start-Process @startInfo
        Write-Log "INFO" "Started API (PID $($proc.Id)) from $apiDir"

        # Wait for startup
        $retries = 10
        $started = $false
        for ($i = 0; $i -lt $retries; $i++) {
            Start-Sleep -Seconds 2
            try {
                $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
                if ($r.StatusCode -eq 200) {
                    Write-Log "OK" "API restarted successfully (PID $($proc.Id))"
                    $started = $true
                    break
                }
            } catch {}
        }
        if (-not $started) {
            Write-Log "ERROR" "API restart failed - still not responding after $($retries * 2)s"
            Write-Log "INFO" "Check logs: $outFile and $errFile"
            exit 2
        }
    } catch {
        Write-Log "FATAL" "Auto-restart failed: $($_.Exception.Message)"
        exit 3
    }
} else {
    Write-Log "ERROR" "API is DOWN. Run with -Restart to auto-recover, or start manually:"
    Write-Log "INFO" "  cd api; npm run dev"
    exit 1
}
