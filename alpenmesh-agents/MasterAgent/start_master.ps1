# start_master.ps1 — AlpenMesh Master Agent pipeline (local, live edge agent mode)
#
# Starts Redis via Docker, then launches all five master services in separate
# windows. Run from the MasterAgent directory or anywhere — uses $PSScriptRoot.
#
# Usage:
#   .\start_master.ps1               # defaults: hybrid agent, rs0 replica set
#   .\start_master.ps1 -Agent rule_based
#   .\start_master.ps1 -Stop         # tear everything down

param(
    [string]$Agent   = "hybrid",
    [string]$MongoUri = "mongodb://localhost:27017/alpenmesh?replicaSet=rs0",
    [string]$RedisUrl = "redis://localhost:6379/0",
    [switch]$Stop
)

$Root = $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"

# ── Tear-down mode ────────────────────────────────────────────────────────────
if ($Stop) {
    Write-Host "Stopping AlpenMesh master pipeline..." -ForegroundColor Yellow
    docker stop alpenmesh-redis 2>$null
    Get-Process | Where-Object { $_.MainWindowTitle -match "alpenmesh-" } | Stop-Process -Force
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
if (-not (Test-Path $Python)) {
    Write-Error "No .venv found at $Root\.venv. Run: python -m venv .venv && .venv\Scripts\pip install -r requirements-sim.txt"
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Install Docker Desktop."
    exit 1
}

# ── 1. Redis (Docker, detached) ───────────────────────────────────────────────
$redisRunning = docker ps --filter "name=alpenmesh-redis" --filter "status=running" -q
if ($redisRunning) {
    Write-Host "[redis]   already running" -ForegroundColor Cyan
} else {
    Write-Host "[redis]   starting..." -ForegroundColor Cyan
    docker run -d --rm --name alpenmesh-redis -p 6379:6379 redis:7-alpine | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "[redis]   ready on :6379" -ForegroundColor Green
}

# ── Shared env for all Python workers ────────────────────────────────────────
$env_block = @"
`$env:MONGO_URI            = '$MongoUri'
`$env:REDIS_URL            = '$RedisUrl'
`$env:MASTER_AGENT_IMPL    = '$Agent'
`$env:PYTHONUNBUFFERED     = '1'
`$env:MASTER_DB_NAME       = 'alpenmesh'
"@

# Helper: open a new PowerShell window for a worker
function Start-Worker {
    param([string]$Title, [string]$Script)
    $cmd = "$env_block; Set-Location '$Root'; Write-Host '[$Title] starting' -ForegroundColor Green; & '$Python' $Script"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd `
        -WindowStyle Normal
}

# ── 2. Ingest worker (MongoDB change stream → Redis hot cache) ────────────────
Write-Host "[ingest]  starting..." -ForegroundColor Cyan
Start-Worker -Title "alpenmesh-ingest" -Script "services/ingest_worker.py"
Start-Sleep -Milliseconds 500

# ── 3. Decision worker (Redis pub/sub → AI → Redis + Mongo) ──────────────────
Write-Host "[decision] starting ($Agent agent)..." -ForegroundColor Cyan
Start-Worker -Title "alpenmesh-decision" -Script "services/decision_worker.py"
Start-Sleep -Milliseconds 500

# ── 4. Outcome worker (feedback loop — measures results 45s post-decision) ───
Write-Host "[outcome] starting..." -ForegroundColor Cyan
Start-Worker -Title "alpenmesh-outcome" -Script "services/outcome_worker.py"
Start-Sleep -Milliseconds 500

# ── 5. Corridor planner (MAXBAND offset solver, runs every 3 min) ─────────────
Write-Host "[planner] starting..." -ForegroundColor Cyan
Start-Worker -Title "alpenmesh-planner" -Script "coordination/planner.py"
Start-Sleep -Milliseconds 500

# ── 6. Master API (FastAPI on :8000) ─────────────────────────────────────────
Write-Host "[api]     starting on http://localhost:8000 ..." -ForegroundColor Cyan
$apiCmd = "$env_block; Set-Location '$Root'; Write-Host '[alpenmesh-api] ready' -ForegroundColor Green; & '$Python' -m uvicorn services.api:app --host 0.0.0.0 --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $apiCmd `
    -WindowStyle Normal

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "AlpenMesh master pipeline running" -ForegroundColor Green
Write-Host "  API          http://localhost:8000"
Write-Host "  Health       http://localhost:8000/health"
Write-Host "  Live state   http://localhost:8000/api/live"
Write-Host "  Decisions    http://localhost:8000/api/decisions"
Write-Host "  Overrides    POST http://localhost:8000/api/override"
Write-Host "  SUMO start   POST http://localhost:8000/api/simulation/start"
Write-Host ""
Write-Host "To stop:  .\start_master.ps1 -Stop" -ForegroundColor Yellow
