#!/usr/bin/env bash
# start_master.sh — AlpenMesh master pipeline (local, live edge agent mode)
#
# Usage:
#   ./start_master.sh          # start everything
#   ./start_master.sh stop     # kill all workers + Redis

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTING_ROOT="$(cd "$ROOT/../ReportingAgent" && pwd)"
PYTHON="$ROOT/.venv/Scripts/python.exe"

MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/alpenmesh?replicaSet=rs0}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
AGENT="${MASTER_AGENT_IMPL:-hybrid}"

PIDFILE="$ROOT/.master_pids"

# ── Colours ───────────────────────────────────────────────────────────────────
green()  { echo -e "\033[32m$*\033[0m"; }
cyan()   { echo -e "\033[36m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }
red()    { echo -e "\033[31m$*\033[0m"; }

# ── Stop mode ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
    yellow "Stopping AlpenMesh master pipeline..."
    if [[ -f "$PIDFILE" ]]; then
        while IFS= read -r pid; do
            kill "$pid" 2>/dev/null && echo "  killed $pid" || true
        done < "$PIDFILE"
        rm -f "$PIDFILE"
    fi
    docker stop alpenmesh-redis 2>/dev/null && echo "  stopped Redis" || true
    green "Done."
    exit 0
fi

# ── Pre-flight ────────────────────────────────────────────────────────────────
if [[ ! -f "$PYTHON" ]]; then
    red "No .venv found. Run: python -m venv .venv && .venv/Scripts/pip install -r requirements.txt"
    exit 1
fi

cyan "Checking deps..."
"$PYTHON" -c "import fastapi, pymongo, redis, cvxpy, structlog" 2>/dev/null || {
    cyan "Installing requirements..."
    "$PYTHON" -m pip install -r "$ROOT/requirements.txt" -q
}
green "Deps OK"

# ── 1. Redis ──────────────────────────────────────────────────────────────────
if docker ps --filter "name=alpenmesh-redis" --filter "status=running" -q | grep -q .; then
    cyan "[redis]   already running"
else
    cyan "[redis]   starting..."
    docker run -d --rm --name alpenmesh-redis -p 6379:6379 redis:7-alpine > /dev/null
    sleep 2
    green "[redis]   ready on :6379"
fi

# ── Shared env ────────────────────────────────────────────────────────────────
export MONGO_URI REDIS_URL MASTER_AGENT_IMPL="$AGENT" PYTHONUNBUFFERED=1 MASTER_DB_NAME=alpenmesh

# Clear old pidfile
> "$PIDFILE"

# Helper: start a worker in background, log to file, record PID
start_worker() {
    local name="$1"; shift
    local logfile="$ROOT/logs/${name}.log"
    mkdir -p "$ROOT/logs"
    "$PYTHON" "$@" >> "$logfile" 2>&1 &
    local pid=$!
    echo "$pid" >> "$PIDFILE"
    cyan "[$name] pid=$pid  log=logs/${name}.log"
}

# ── 2. Ingest worker ──────────────────────────────────────────────────────────
start_worker "ingest"   services/ingest_worker.py

# ── 3. Decision worker ────────────────────────────────────────────────────────
start_worker "decision" services/decision_worker.py

# ── 4. Outcome worker ─────────────────────────────────────────────────────────
start_worker "outcome"  services/outcome_worker.py

# ── 5. Corridor planner ───────────────────────────────────────────────────────
start_worker "planner"  coordination/planner.py

# ── 6. Reporting agent ────────────────────────────────────────────────────────
if [[ -f "$REPORTING_ROOT/reporting_agent.py" ]]; then
    # Install reporting agent deps if needed
    "$PYTHON" -c "import httpx" 2>/dev/null || "$PYTHON" -m pip install -r "$REPORTING_ROOT/requirements.txt" -q
    REPORTING_LOGFILE="$ROOT/logs/reporting.log"
    mkdir -p "$ROOT/logs"
    MASTER_AGENT_URL="http://localhost:8080" \
    "$PYTHON" -m uvicorn reporting_agent:app --host 0.0.0.0 --port 8001 \
        --app-dir "$REPORTING_ROOT" >> "$REPORTING_LOGFILE" 2>&1 &
    echo "$!" >> "$PIDFILE"
    cyan "[reporting] pid=$!  log=logs/reporting.log  →  http://localhost:8001"
else
    yellow "[reporting] not found at $REPORTING_ROOT — skipping"
fi

# ── 7. Master API (foreground — Ctrl+C stops it; workers killed via stop) ─────
green ""
green "AlpenMesh pipeline running"
echo  "  Master API    →  http://localhost:8080"
echo  "  Reporting     →  http://localhost:8001"
echo  "  Health        →  http://localhost:8080/health"
echo  "  Live state    →  http://localhost:8080/api/live"
echo  "  Decisions     →  http://localhost:8080/api/decisions"
echo  "  Override      →  POST http://localhost:8080/api/override"
echo  "  SUMO start    →  POST http://localhost:8080/api/simulation/start"
echo  "  Alerts        →  http://localhost:8001/alerts"
echo  "  Accidents     →  http://localhost:8001/accidents"
echo  ""
yellow "Workers running in background. Logs in ./logs/"
yellow "Stop all: bash start_master.sh stop"
echo  ""

exec "$PYTHON" -m uvicorn services.api:app --host 0.0.0.0 --port 8080 --reload
