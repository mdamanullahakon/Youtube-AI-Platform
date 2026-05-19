#!/usr/bin/env pwsh
param(
    [Parameter(Mandatory)]
    [string]$Service,
    [int]$TimeoutSeconds = 30,
    [int]$IntervalSeconds = 2
)

$ErrorActionPreference = "Stop"

$elapsed = 0
while ($elapsed -lt $TimeoutSeconds) {
    $healthy = docker ps --filter "name=$Service" --filter "health=healthy" --format "{{.Names}}"
    if ($healthy) {
        Write-Host "[$Service] healthy after ${elapsed}s" -ForegroundColor Green
        exit 0
    }
    Start-Sleep -Seconds $IntervalSeconds
    $elapsed += $IntervalSeconds
}

Write-Host "[$Service] did not become healthy within ${TimeoutSeconds}s" -ForegroundColor Red
exit 1