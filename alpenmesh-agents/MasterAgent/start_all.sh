#!/usr/bin/env bash
# start_all.sh — AlpenMesh full stack launcher
#
# Usage:
#   bash start_all.sh        # start everything
#   bash start_all.sh stop   # stop everything

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"      # alpenmesh-agents/
FYP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"      # FYP-PreJobFair/

LOGDIR="$SCRIPT_DIR/logs"
PIDFILE="$SCRIPT_DIR/.all_pids"

green()  { echo -e "\033[32m$*\033[0m"; }
cyan()   { echo -e "\033[36m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }
red()    { echo -e "\033[31m$*\033[0m"; }

# ── Stop mode ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
    yellow "Stopping all AlpenMesh services..."
    bash "$SCRIPT_DIR/start_master.sh" stop
    if [[ -f "$PIDFILE" ]]; then
        while IFS= read -r pid; do
            kill "$pid" 2>/dev/null && echo "  killed $pid" || true
        done < "$PIDFILE"
        rm -f "$PIDFILE"
    fi
    green "Done."
    exit 0
fi

mkdir -p "$LOGDIR"
> "$PIDFILE"

# bg <name> <dir> <cmd...>  — run cmd in dir as background process, log to logs/<name>.log
bg() {
    local name="$1" dir="$2"; shift 2
    local logfile="$LOGDIR/${name}.log"
    (cd "$dir" && "$@") >> "$logfile" 2>&1 &
    local pid=$!
    echo "$pid" >> "$PIDFILE"
    cyan "[$name]  pid=$pid  log=logs/${name}.log"
}

# ── 1. Master pipeline (Redis + ingest/decision/outcome/planner + API on :8000) ──
bg "master"            "$SCRIPT_DIR" \
    bash start_master.sh

# ── 2. Operator control — Express server ──────────────────────────────────────
bg "op-server"         "$FYP_ROOT/alpenmesh-operator-control/server" \
    npx nodemon server.js

# ── 3. Operator control — React client on :5173 ───────────────────────────────
bg "op-client"         "$FYP_ROOT/alpenmesh-operator-control/client" \
    pnpm dev

# ── 4. Edge worker (Rust release) ─────────────────────────────────────────────
bg "edge-worker"       "$AGENTS_ROOT/EdgeAgent/alpenmesh-edge-worker" \
    cargo run --bin alpenmesh-worker --release

# ── 5. Edge scheduler (Rust release) ─────────────────────────────────────────
bg "edge-scheduler"    "$AGENTS_ROOT/EdgeAgent/alpenmesh-edge-scheduler" \
    cargo run --release

# ── 6. Economy backend (Rust release) ─────────────────────────────────────────
bg "economy-backend"   "$FYP_ROOT/alpenmesh-coin/alpenmesh-economy" \
    cargo run --release

# ── 7. Economy frontend ───────────────────────────────────────────────────────
bg "economy-frontend"  "$FYP_ROOT/alpenmesh-coin/alpenmesh-economy-frontend" \
    pnpm dev

green ""
green "AlpenMesh full stack started"
echo "  Master API         →  http://localhost:8080"
echo "  Reporting Agent    →  http://localhost:8001"
echo "  Operator Control   →  http://localhost:5173"
echo ""
echo "  Logs in ./logs/ — tail any with:"
echo "    tail -f logs/<name>.log"
echo ""
yellow "Stop all:  bash start_all.sh stop"
