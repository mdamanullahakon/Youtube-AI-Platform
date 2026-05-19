@echo off
title YouTube AI Platform Launcher

set "ROOT=%~dp0"

echo ================================
echo Starting YouTube AI Platform
echo ================================

REM Start Database (Docker) — down first to prevent container name conflicts
echo [1/3] Starting PostgreSQL + Redis...
cd /d "%ROOT%"
docker compose -f docker/docker-compose.local.yml down
docker compose -f docker/docker-compose.local.yml up -d postgres redis

REM Wait for DB
echo Waiting for database...
:waitdb
docker compose -f docker/docker-compose.local.yml exec -T postgres pg_isready -U postgres >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto waitdb
)
echo DB ready.

REM Run Prisma migrations
echo [2/3] Running Prisma migrations...
cd /d "%ROOT%api"
npx prisma generate >nul 2>&1
npx prisma db push --accept-data-loss >nul 2>&1

REM Start Backend + Frontend in new windows
echo [3/3] Starting development servers...
start "API" cmd /k "cd /d "%ROOT%api" && npm run dev"
start "Dashboard" cmd /k "cd /d "%ROOT%apps\dashboard" && npm run dev"

echo ================================
echo  API:       http://localhost:4000
echo  Dashboard: http://localhost:3000
echo ================================

timeout /t 10

REM Open browser
start http://localhost:3000

echo All services starting...
pause
