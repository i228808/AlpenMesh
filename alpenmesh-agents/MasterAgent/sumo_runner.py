"""
sumo_runner.py — Multi-mode SUMO simulation runner for the corridor advisory system.

Controller modes (set via CONTROLLER_MODE env var):
  fixed_time     — SUMO's built-in fixed-time plans, no agent involvement
  hybrid         — New SOTA MPC + MaxPressure + ModeSelector + SafetyWrapper
  mpc            — New SOTA MPC only (wrapped in SafetyWrapper)
  maxpressure    — New SOTA Max-Pressure only
  rule_based     — Refactored rule-based agent (Tier-1/Tier-2)
  original_rules — Legacy rule-based agent (master_agent_v1.py)
  tier1_only     — Legacy demand score engine, corridor propagation DISABLED
  tier1_tier2    — Legacy engine + Tier-2 arbitration, corridor propagation DISABLED
  full           — Same as rule_based

Per-step CSV logging to: results/<seed>_<demand>_<mode>.csv
"""

import csv
import os
import sys
import json
import time
import math
import random
import requests
from pathlib import Path
from pymongo import MongoClient

# Configure SUMO_HOME
if 'SUMO_HOME' in os.environ:
    tools = os.path.join(os.environ['SUMO_HOME'], 'tools')
    sys.path.append(tools)
else:
    possible_path = r"C:\Program Files (x86)\Eclipse\Sumo\tools"
    if os.path.exists(possible_path):
        sys.path.append(possible_path)
    else:
        print("WARN: SUMO_HOME not set and default tools path not found.")

try:
    import traci
    import sumolib
except ImportError:
    sys.exit("Error: Could not import traci or sumolib. Please install them or set SUMO_HOME.")

# ==========================
# Configuration
# ==========================

BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
NET_FILE      = os.path.abspath(os.path.join(BASE_DIR, "seattlecity.net.xml"))
MAPPING_FILE  = os.path.abspath(os.path.join(BASE_DIR, "camera_mapping.json"))
RESULTS_DIR   = os.path.join(BASE_DIR, "results")
MONGO_URI     = os.getenv("MONGO_URI", "mongodb://admin:adminpassword@localhost:27017/alpenmesh")
DB_NAME       = "alpenmesh"
METRICS_COL   = "traffic_metrics"
MASTER_API_URL = "http://localhost:8080"

SIM_STEP_LENGTH = 0.5
CONTROL_INTERVAL = 1.0

# Phase-transition safety clearance (must match agents/safety.py)
YELLOW_S  = float(os.getenv("YELLOW_S",  "3"))
ALL_RED_S = float(os.getenv("ALL_RED_S", "2"))

# Per-TLS pending clearance registry: tls_id -> {target_phase, clearance_end_sim}
# Once the yellow+all-red window elapses in sim time, the deferred target
# green is committed by _service_pending_clearances().
_tls_clearance: dict = {}

# Per-TLS preemption cooldown registry.
# Mapped cameras only observe NS approaches (UP/DOWN) — they do not see the
# EW cross-street movement, so naively honouring every agent decision would
# force NS 100% of the time and starve EW. The fix: after each agent-initiated
# switch, mark the TLS as "cooled down" for roughly one full program cycle so
# SUMO's native fixed-time plan can rotate through the cross-street phase(s).
# The agent regains preemption authority once the cooldown expires. An
# emergency-preemption path (see _is_current_phase_idle) still lets the agent
# intervene mid-cooldown if SUMO is wasting green on a clearly empty phase.
_tls_preempt_cooldown_until: dict = {}          # tls_id -> sim_time when cooldown ends
_tls_program_cycle_s: dict = {}                 # tls_id -> cached cycle duration (s)
# Phase-age tracker for respecting minimum phase service time irrespective of who
# started the phase (SUMO natural transition or our own setPhase). Prevents the
# agent from killing a green that just started.
_tls_current_phase_idx:    dict = {}            # tls_id -> last observed phase index
_tls_current_phase_start:  dict = {}            # tls_id -> sim_time when current phase started

# Per-TLS "decision committed this tick" lock. When two cameras share the same
# TLS (paired-camera deployment) they may fire decisions back-to-back in the
# same simulation tick. Without this lock the second decision can clobber a
# fresh setPhase / clearance started by the first, yielding flapping behaviour.
# The lock resets every sim step from the main loop so genuinely new decisions
# on the next tick still pass.
_tls_apply_lock_step:      dict = {}            # tls_id -> sim_time of last apply

PREEMPT_COOLDOWN_FLOOR_S = float(os.getenv("PREEMPT_COOLDOWN_FLOOR_S", "45"))
PREEMPT_COOLDOWN_SCALE   = float(os.getenv("PREEMPT_COOLDOWN_SCALE",   "0.0"))
# Minimum age of the current SUMO phase before agent is allowed to preempt it.
RESPECT_MIN_PHASE_S      = float(os.getenv("RESPECT_MIN_PHASE_S",      "3"))
# Emergency-preemption thresholds (during cooldown):
EMERG_PREEMPT_RATIO      = float(os.getenv("EMERG_PREEMPT_RATIO",      "1.15"))
EMERG_PREEMPT_MARGIN_VEH = float(os.getenv("EMERG_PREEMPT_MARGIN_VEH", "1.0"))

# Direct SUMO-native queue preemption (runs independent of agent/metrics).
# If a non-green phase has >= DIRECT_PREEMPT_HIGH_Q halted vehicles AND the
# current green phase has <= DIRECT_PREEMPT_IDLE_Q halted vehicles, switch
# immediately. Covers the case where the agent's camera-based metrics are
# sparse/stale but SUMO itself has a large internal queue building up.
DIRECT_PREEMPT_HIGH_Q = float(os.getenv("DIRECT_PREEMPT_HIGH_Q", "8"))
DIRECT_PREEMPT_IDLE_Q = float(os.getenv("DIRECT_PREEMPT_IDLE_Q", "3"))

# Phase extension — crucial for beating fixed-time under asymmetric demand.
# When the agent asks to PRIORITIZE the approach that's ALREADY green AND
# the phase is near its end AND there's still queue to drain, we add a small
# green-extension chunk. Total phase duration is bounded by EXTEND_MAX_PHASE_S
# so the cross-street is never starved more than ~a cycle.
EXTEND_STEP_S       = float(os.getenv("EXTEND_STEP_S", "3"))
EXTEND_MAX_PHASE_S  = float(os.getenv("EXTEND_MAX_PHASE_S", "35"))
# Setting EXTEND_NEAR_END_S=0 disables phase extension. Phase extension
# disrupts coordinated green-wave timing (it only serves camera-observed NS
# approaches) and consistently reduces network throughput. Background cycle
# adaptation (ScootCycleAdapter) is the correct mechanism instead.
EXTEND_NEAR_END_S   = float(os.getenv("EXTEND_NEAR_END_S", "0"))
EXTEND_MIN_QUEUE    = float(os.getenv("EXTEND_MIN_QUEUE", "3"))

# Consolidated rotating JSONL debug log (see observability/debug_log.py).
DEBUG_LOG_PATH = os.path.join(BASE_DIR, "debug-c90683.log")
os.environ.setdefault("DEBUG_LOG_PATH", DEBUG_LOG_PATH)
try:
    from observability.debug_log import dbg as _dbg
except Exception:  # pragma: no cover
    def _dbg(location, message, data=None):
        return

# Experiment parameters (overridden by run_experiments.py via env vars)
CONTROLLER_MODE   = os.getenv("CONTROLLER_MODE", "full")
RANDOM_SEED       = int(os.getenv("RANDOM_SEED", "42"))
DEMAND_LEVEL      = os.getenv("DEMAND_LEVEL", "medium")   # low / medium / high
SIM_DURATION_S    = int(os.getenv("SIM_DURATION_S", "600"))  # 10 minutes default
HEADLESS          = os.getenv("HEADLESS", "0") == "1"
# Synthetic benchmark mode: derive agent inputs from SUMO state directly,
# bypassing MongoDB / edge-agent pipeline. Useful for offline controller bench.
SYNTHETIC_METRICS = os.getenv("SYNTHETIC_METRICS", "0") == "1"
# Synthetic demand: spawn vehicles at random edges each second (bypasses Mongo spawns).
SYNTHETIC_DEMAND  = os.getenv("SYNTHETIC_DEMAND",  "0") == "1"

# Demand multipliers (vehicles per second base rate × multiplier)
DEMAND_MULTIPLIERS = {"low": 0.3, "medium": 1.0, "high": 2.0}

# Demand profile: shape the per-camera mock metrics that feed spawn_from_metrics.
#   "balanced"    -> {UP:5, DOWN:5}           (default — old behaviour)
#   "asymmetric"  -> {UP:15, DOWN:2}          (heavy NS, thin cross — stresses fixed-time)
#   "peak"        -> time-varying: low/high/low cycles within a run
# This is what exposes the adaptive agent's edge: fixed-time allocates equal
# green regardless, while Max-Pressure / MPC can shift service to the heavy axis.
DEMAND_PROFILE = os.getenv("DEMAND_PROFILE", "balanced").lower()

def _profile_counts(sim_time_s: float) -> dict:
    """Return per-camera mock vehicle_counts for the active DEMAND_PROFILE.

    All profiles now include Poisson-like noise so adaptive controllers have
    a real stochastic signal to exploit (constant demand makes fixed-time
    unbeatable — adaptive control only adds value under variability).
    """
    # Per-step deterministic RNG: reproducible across all modes for a given seed.
    rng = random.Random(int(sim_time_s) * 1013 + RANDOM_SEED * 997)

    if DEMAND_PROFILE == "asymmetric":
        # Heavy NS, light EW with per-step variation.
        return {
            "UP":    max(0, int(rng.gauss(15, 3))),
            "DOWN":  max(0, int(rng.gauss(2,  1))),
            "LEFT":  max(0, int(rng.gauss(2,  1))),
            "RIGHT": max(0, int(rng.gauss(15, 3))),
        }
    if DEMAND_PROFILE == "peak":
        t = sim_time_s % 120.0
        if t < 30 or t >= 90:
            base = {"UP": 3, "DOWN": 3}
        else:
            base = {"UP": 18, "DOWN": 4, "LEFT": 4, "RIGHT": 18}
        return {k: max(0, int(rng.gauss(v, max(1.0, v * 0.2)))) for k, v in base.items()}
    if DEMAND_PROFILE == "bursty":
        # Alternating directional surges + high variance — the hardest case
        # for fixed-time, the showcase case for adaptive control.
        pulse_up   = 12.0 if (sim_time_s % 90)  < 25 else 0.0
        pulse_down = 10.0 if 45 < (sim_time_s % 120) < 70 else 0.0
        up   = max(0, int(rng.gauss(5 + pulse_up,   max(1.5, (5 + pulse_up)   * 0.30))))
        down = max(0, int(rng.gauss(5 + pulse_down, max(1.5, (5 + pulse_down) * 0.30))))
        return {"UP": up, "DOWN": down,
                "LEFT":  max(0, int(rng.gauss(2, 1))),
                "RIGHT": max(0, int(rng.gauss(2, 1)))}
    # balanced (default): slow sinusoidal oscillation + noise.
    # Pure constant demand → fixed-time is theoretically optimal.
    # Oscillation gives adaptive control a genuine signal to exploit.
    wave = 2.5 * math.sin(2 * math.pi * sim_time_s / 90.0)
    return {
        "UP":   max(1, int(rng.gauss(5 + wave, 1.5))),
        "DOWN": max(1, int(rng.gauss(5 - wave, 1.5))),
    }

# Cache for destination edges
DESTINATION_EDGES = []

# ==========================
# Agent import by mode
# ==========================

def _load_agent(mode: str):
    """Return the appropriate agent instance for the given controller mode."""
    if mode == "original_rules":
        # Import the archived v1 agent
        sys.path.insert(0, BASE_DIR)
        import importlib
        v1 = importlib.import_module("master_agent_v1")
        return v1.RuleBasedMasterAgent()
    elif mode == "fixed_time":
        return None  # No agent; SUMO runs its default fixed-time plans

    from agents import load as load_agent

    if mode in ("rule_based", "mpc", "maxpressure", "hybrid"):
        return load_agent(mode)

    # Legacy modes mapping to rule_based
    agent = load_agent("rule_based")

    if mode == "tier1_only":
        # Monkey-patch corridor manager to be a no-op
        from corridor import CorridorManager
        agent._corridor_mgr = CorridorManager()  # empty — no corridors loaded

    elif mode == "tier1_tier2":
        # Disable corridor propagation but keep Tier-2 arbitration intact
        from corridor import CorridorManager
        agent._corridor_mgr = CorridorManager()  # empty corridors

    # "full" → use agent as-is with full corridor propagation
    return agent


# ==========================
# Helpers
# ==========================

def get_lane_to_tls_map():
    lane_to_tls = {}
    try:
        tls_ids = traci.trafficlight.getIDList()
        for tls in tls_ids:
            lanes = traci.trafficlight.getControlledLanes(tls)
            for lane in lanes:
                lane_to_tls[lane] = tls
    except Exception as e:
        print(f"Error building TLS map: {e}")
    return lane_to_tls


def find_green_phase_for_lane(tls_id, lane_id):
    try:
        logic = traci.trafficlight.getAllProgramLogics(tls_id)[0]
        controlled_lanes = traci.trafficlight.getControlledLanes(tls_id)
        if lane_id not in controlled_lanes:
            return None
        lane_index = controlled_lanes.index(lane_id)
        for i, phase in enumerate(logic.phases):
            state = phase.state
            if len(state) > lane_index:
                if state[lane_index] in ['G', 'g']:
                    return i
    except Exception:
        return None
    return None


def _update_phase_tracker(tls_id, current_phase, sim_time_now):
    """Record the transition into `current_phase` and return its age in seconds.

    If this is the first time we see ``current_phase`` for this TLS, or it has
    changed since the last observation, reset the phase-start timestamp to now.
    """
    prev_phase = _tls_current_phase_idx.get(tls_id)
    if prev_phase != current_phase:
        _tls_current_phase_idx[tls_id]    = current_phase
        _tls_current_phase_start[tls_id]  = sim_time_now
        return 0.0
    return sim_time_now - _tls_current_phase_start.get(tls_id, 0.0)


def _phase_queue(tls_id, phase_idx, logic, controlled_lanes):
    """Sum of halted vehicles on the lanes that `phase_idx` gives green to."""
    try:
        state = logic.phases[phase_idx].state
    except Exception:
        return 0.0
    q = 0.0
    for i, lane in enumerate(controlled_lanes):
        if i >= len(state):
            break
        if state[i] in ("G", "g"):
            try:
                q += traci.lane.getLastStepHaltingNumber(lane)
            except Exception:
                continue
    return q


def _should_emergency_preempt(tls_id, current_phase, target_phase):
    """Allow a preemption when SUMO's current phase is wasting green on an
    empty movement while the agent's target movement has demand.

    Special case: if the current phase is completely idle (cur_q == 0) and
    the target has any queue at all, preempt immediately — there is zero cost
    to switching away from a phase serving nobody.
    """
    try:
        logic = traci.trafficlight.getAllProgramLogics(tls_id)[0]
        controlled_lanes = traci.trafficlight.getControlledLanes(tls_id)
    except Exception:
        return False
    cur_q = _phase_queue(tls_id, current_phase, logic, controlled_lanes)
    tgt_q = _phase_queue(tls_id, target_phase, logic, controlled_lanes)
    if cur_q == 0 and tgt_q > 0:
        return True
    return (tgt_q > cur_q * EMERG_PREEMPT_RATIO
            and tgt_q > cur_q + EMERG_PREEMPT_MARGIN_VEH)


def _direct_queue_preemption(sim_time: float, all_tls_ids: list) -> None:
    """SUMO-native queue-based preemption — runs every control cycle.

    For every TLS: if the currently green phase is idle (halted <= IDLE_Q)
    and any other green-capable phase has a queue >= HIGH_Q, switch to it.
    This operates purely on TraCI lane state and is completely independent of
    the agent / MongoDB metrics pipeline. It ensures large SUMO-internal queues
    are drained even when camera metrics are sparse or stale.
    """
    for tls_id in all_tls_ids:
        if tls_id in _tls_clearance:
            continue
        try:
            logic            = traci.trafficlight.getAllProgramLogics(tls_id)[0]
            controlled_lanes = traci.trafficlight.getControlledLanes(tls_id)
            current_phase    = traci.trafficlight.getPhase(tls_id)
        except Exception:
            continue

        phase_age = sim_time - _tls_current_phase_start.get(tls_id, 0.0)
        if phase_age < RESPECT_MIN_PHASE_S:
            continue

        cur_q = _phase_queue(tls_id, current_phase, logic, controlled_lanes)
        if cur_q > DIRECT_PREEMPT_IDLE_Q:
            continue  # current green is still serving vehicles — leave it alone

        # When current green is completely idle, any waiting vehicle qualifies.
        # Otherwise require the candidate to beat DIRECT_PREEMPT_HIGH_Q.
        min_candidate_q = 1.0 if cur_q == 0 else DIRECT_PREEMPT_HIGH_Q

        # Find the non-current green phase with the highest queue
        best_phase = None
        best_q     = min_candidate_q
        phases     = logic.phases
        for i, ph in enumerate(phases):
            if i == current_phase:
                continue
            # Accept any phase that gives green — uppercase G or lowercase g
            if 'G' not in ph.state and 'g' not in ph.state:
                continue
            q = _phase_queue(tls_id, i, logic, controlled_lanes)
            if q > best_q:
                best_q     = q
                best_phase = i

        if best_phase is not None:
            _dbg("sumo_runner.py:_direct_queue_preemption", "queue_preempt", {
                "tls_id":        tls_id,
                "current_phase": current_phase,
                "cur_q":         cur_q,
                "target_phase":  best_phase,
                "target_q":      best_q,
                "sim_time":      sim_time,
            })
            _initiate_clearance_switch(tls_id, current_phase, best_phase, sim_time)
            # Record clearance initiation time so RESPECT_MIN_PHASE_S is enforced
            # for non-camera TLS that never go through apply_decision.
            _tls_current_phase_idx[tls_id]   = current_phase
            _tls_current_phase_start[tls_id] = sim_time
            # Lock the clearance so apply_decision can't overwrite the target
            # phase mid-clearance (that would commit the idle phase with a hold).
            # Also attach a minimum hold so the queue has time to drain.
            if tls_id in _tls_clearance:
                # Hold proportional to queue size, but at least 8s and at most 30s.
                _tls_clearance[tls_id]["min_green_s"] = max(min(best_q * 1.5, 30.0), 8.0)
                _tls_clearance[tls_id]["locked"] = True


def _get_tls_cycle_s(tls_id):
    """Cache and return the total program cycle duration for a TLS (sec).

    Falls back to ``PREEMPT_COOLDOWN_FLOOR_S`` if the program can't be read.
    """
    cached = _tls_program_cycle_s.get(tls_id)
    if cached is not None:
        return cached
    try:
        logic = traci.trafficlight.getAllProgramLogics(tls_id)[0]
        total = float(sum(p.duration for p in logic.phases))
        total = max(total, PREEMPT_COOLDOWN_FLOOR_S)
    except Exception:
        total = PREEMPT_COOLDOWN_FLOOR_S
    _tls_program_cycle_s[tls_id] = total
    return total


def _service_pending_clearances(sim_time_now):
    """Commit deferred green phases once their yellow+all-red window has elapsed.

    Safe to call any number of times per step; only TLSs whose clearance
    window has expired actually transition, and each is removed once committed.

    Preemption cooldown is no longer used — the demand-asymmetry gate in
    apply_decision is sufficient to prevent over-preemption without the
    cross-street starvation side-effect a blanket cooldown caused.
    """
    if not _tls_clearance:
        return
    done = []
    for tls_id, st in _tls_clearance.items():
        if sim_time_now >= st["clearance_end_sim"]:
            try:
                traci.trafficlight.setPhase(tls_id, st["target_phase"])
                # Hold the target phase for at least min_green_s so SUMO's native
                # schedule can't cycle back before the queue has a chance to drain.
                min_green = st.get("min_green_s", 0.0)
                if min_green > 0:
                    traci.trafficlight.setPhaseDuration(tls_id, min_green)
                # Record phase-start so RESPECT_MIN_PHASE_S is enforced correctly.
                _tls_current_phase_idx[tls_id]   = st["target_phase"]
                _tls_current_phase_start[tls_id] = sim_time_now
                # #region agent log
                _dbg("sumo_runner.py:_service_pending_clearances", "committed_target_green", {
                    "hypothesisId": "H2",
                    "target_tls":     tls_id,
                    "target_phase":   st["target_phase"],
                    "min_green_s":    min_green,
                    "sim_time":       sim_time_now,
                })
                # #endregion
            except Exception as e:
                _dbg("sumo_runner.py:_service_pending_clearances", "commit_error",
                     {"tls_id": tls_id, "error": str(e)})
            done.append(tls_id)
    for t in done:
        _tls_clearance.pop(t, None)


def _initiate_clearance_switch(tls_id, current_phase, target_phase, sim_time_now,
                               camera_name=None, target_roi=None):
    """Walk the TLS through yellow -> all-red -> target green safely.

    If the current phase already contains a yellow signal, we assume
    SUMO's program is mid-transition and just schedule the final commit.
    Otherwise we search the program for the yellow phase that follows
    the current green, jump to it with duration = YELLOW_S + ALL_RED_S,
    and record the target green to commit once that window elapses.
    """
    pending = _tls_clearance.get(tls_id)
    if pending is not None:
        # Already mid-clearance; just update the target so the latest decision wins
        pending["target_phase"] = target_phase
        return

    try:
        logic = traci.trafficlight.getAllProgramLogics(tls_id)[0]
    except Exception:
        # Can't introspect program — fall back to old (unsafe) direct jump
        try:
            traci.trafficlight.setPhase(tls_id, target_phase)
        except Exception:
            pass
        return

    phases = logic.phases
    try:
        cur_state = phases[current_phase].state
    except Exception:
        cur_state = ""

    has_yellow = any(c in ("y", "Y") for c in cur_state)
    all_red    = cur_state and all(c in ("r", "R") for c in cur_state)

    if has_yellow or all_red:
        # Already in a clearance-like state; just wait out YELLOW_S + ALL_RED_S
        _tls_clearance[tls_id] = {
            "target_phase":      target_phase,
            "clearance_end_sim": sim_time_now + YELLOW_S + ALL_RED_S,
        }
        # #region agent log
        _dbg("sumo_runner.py:_initiate_clearance_switch", "clearance_already_active", {
            "hypothesisId": "H2",
            "tls_id":        tls_id,
            "current_phase": current_phase,
            "cur_state":     cur_state,
            "target_phase":  target_phase,
            "sim_time":      sim_time_now,
        })
        # #endregion
        return

    # Search forward in the program for the yellow phase that follows this green.
    n = len(phases)
    yellow_idx = None
    for offset in range(1, n + 1):
        idx = (current_phase + offset) % n
        ps = phases[idx].state
        if any(c in ("y", "Y") for c in ps):
            yellow_idx = idx
            break
        # If we hit another green before finding yellow, there's no yellow
        # separator defined in this program — stop searching.
        if any(c in ("g", "G") for c in ps):
            break

    if yellow_idx is None:
        # No yellow phase available; fall back to direct jump (legacy behaviour)
        try:
            traci.trafficlight.setPhase(tls_id, target_phase)
            # #region agent log
            _dbg("sumo_runner.py:_initiate_clearance_switch", "no_yellow_fallback_jump", {
                "hypothesisId": "H2",
                "tls_id":       tls_id,
                "current_phase": current_phase,
                "target_phase":  target_phase,
            })
            # #endregion
        except Exception:
            pass
        return

    try:
        traci.trafficlight.setPhase(tls_id, yellow_idx)
        traci.trafficlight.setPhaseDuration(tls_id, YELLOW_S + ALL_RED_S)
    except Exception as e:
        _dbg("sumo_runner.py:_initiate_clearance_switch", "setPhase_yellow_error",
             {"tls_id": tls_id, "error": str(e)})
        return

    _tls_clearance[tls_id] = {
        "target_phase":      target_phase,
        "clearance_end_sim": sim_time_now + YELLOW_S + ALL_RED_S,
    }
    # #region agent log
    _dbg("sumo_runner.py:_initiate_clearance_switch", "clearance_started", {
        "hypothesisId":  "H2",
        "camera":        camera_name,
        "target_roi":    target_roi,
        "tls_id":        tls_id,
        "current_phase": current_phase,
        "yellow_phase":  yellow_idx,
        "target_phase":  target_phase,
        "clearance_end_sim": sim_time_now + YELLOW_S + ALL_RED_S,
        "sim_time":      sim_time_now,
    })
    # #endregion


def apply_decision(decision, cam_mapping, lane_to_tls, camera_name=None):
    action     = decision.get("action")
    target_roi = decision.get("target_roi")

    # Always progress any deferred clearances first — even if this particular
    # decision is a no-op, another intersection may be waiting to commit.
    sim_time_now = traci.simulation.getTime()
    _service_pending_clearances(sim_time_now)

    if action in ("NO_ACTION", "HOLD", "FALLBACK", "CLEARANCE_HOLD", None) or not target_roi:
        return

    lanes = cam_mapping.get("lane_map", {}).get(target_roi.upper(), [])

    # If not found, try to reverse-map the new canonical approaches back to UP/DOWN/LEFT/RIGHT
    if not lanes and camera_name:
        try:
            from topology.roi_adapter import RoiMapper
            mapper = RoiMapper(os.path.join(BASE_DIR, "topology", "roi_mapping.yaml"))
            loc = mapper.resolve(camera_name, target_roi)
            if not loc and target_roi in ("N", "S", "E", "W"):
                loc = type('obj', (object,), {'approach': target_roi, 'movement': 'through'})()

            if loc:
                intersection_id = mapper._camera_to_intersection(camera_name)
                for (iid, roi_upper), explicit_loc in mapper._explicit.items():
                    if iid == intersection_id and explicit_loc.approach == loc.approach and explicit_loc.movement == loc.movement:
                        lanes = cam_mapping.get("lane_map", {}).get(roi_upper, [])
                        if lanes:
                            break
        except Exception as e:
            print(f"Error reverse-mapping ROI '{target_roi}': {e}")

    if not lanes:
        return

    target_tls  = None
    target_lane = None

    for lane in lanes:
        if lane in lane_to_tls:
            target_tls  = lane_to_tls[lane]
            target_lane = lane
            break

    if not target_tls:
        return

    if action in ("SWITCH_GREEN", "PRIORITIZE", "EXTEND_GREEN",
                  "EXTEND_CURRENT_PHASE", "KEEP_GREEN"):
        phase_idx = find_green_phase_for_lane(target_tls, target_lane)
        if phase_idx is None:
            return

        # Paired-camera race guard: if another camera already committed a
        # decision for this TLS in the current sim tick, defer. The safety
        # override bypasses so starvation protections still run.
        is_safety = bool(decision.get("safety", False)) if isinstance(decision, dict) else False
        last_apply = _tls_apply_lock_step.get(target_tls)
        if (not is_safety
                and last_apply is not None
                and abs(sim_time_now - last_apply) < 1e-3):
            _dbg("sumo_runner.py:apply_decision", "paired_camera_race_deferred", {
                "hypothesisId":  "H2",
                "camera":        camera_name,
                "target_tls":    target_tls,
                "new_phase":     phase_idx,
                "sim_time":      sim_time_now,
            })
            return

        # If this TLS is mid-clearance, don't disturb — just update the pending
        # target (the latest decision wins) and let the clearance run to completion.
        # Exception: if the clearance was initiated by _direct_queue_preemption
        # (locked=True), the agent must not overwrite the target — that would
        # commit the idle phase with a 15s hold and make the queue worse.
        if target_tls in _tls_clearance:
            if not _tls_clearance[target_tls].get("locked", False):
                _tls_clearance[target_tls]["target_phase"] = phase_idx
            _tls_apply_lock_step[target_tls] = sim_time_now
            # #region agent log
            _dbg("sumo_runner.py:apply_decision", "update_pending_clearance_target", {
                "hypothesisId":  "H2",
                "camera":        camera_name,
                "target_tls":    target_tls,
                "new_target_phase": phase_idx,
                "locked":        _tls_clearance[target_tls].get("locked", False),
                "sim_time":      sim_time_now,
            })
            # #endregion
            return

        current_phase = traci.trafficlight.getPhase(target_tls)
        phase_age = _update_phase_tracker(target_tls, current_phase, sim_time_now)

        if current_phase == phase_idx:
            # Green extension — textbook rule: only extend when phase is
            # NEAR END and demand still exists. Otherwise SUMO's native timing
            # is correct and we should leave it alone.
            try:
                next_switch = traci.trafficlight.getNextSwitch(target_tls)
                remaining   = max(0.0, next_switch - sim_time_now)
                # Not near end? Don't touch. SUMO will keep serving us.
                if remaining > EXTEND_NEAR_END_S:
                    return
                # Near end. Check residual queue on the green lanes.
                try:
                    _logic  = traci.trafficlight.getAllProgramLogics(target_tls)[0]
                    _lanes  = traci.trafficlight.getControlledLanes(target_tls)
                    residual_q = _phase_queue(target_tls, phase_idx, _logic, _lanes)
                except Exception:
                    residual_q = 0.0
                if residual_q < EXTEND_MIN_QUEUE:
                    return
                headroom  = max(0.0, EXTEND_MAX_PHASE_S - phase_age - remaining)
                extend_by = min(EXTEND_STEP_S, headroom)
                if extend_by > 0.25:
                    traci.trafficlight.setPhaseDuration(target_tls, remaining + extend_by)
                    _tls_apply_lock_step[target_tls] = sim_time_now
                    _dbg("sumo_runner.py:apply_decision", "extended_current_phase", {
                        "hypothesisId":   "EXT",
                        "camera":         camera_name,
                        "target_tls":     target_tls,
                        "current_phase":  current_phase,
                        "phase_age_s":    round(phase_age, 2),
                        "remaining_s":    round(remaining, 2),
                        "residual_q":     round(residual_q, 2),
                        "extend_by_s":    round(extend_by, 2),
                        "sim_time":       sim_time_now,
                    })
            except Exception:
                pass
            return

        # Preemption gating. Only one hard gate remains:
        #   - Current phase must be older than RESPECT_MIN_PHASE_S (3 s).
        #     Don't kill a phase that just started — the clearance penalty
        #     alone would cost more than any gain.
        #
        # The old demand-asymmetry gate (_should_emergency_preempt) has been
        # removed. MPC and MaxPressure only emit PRIORITIZE (never SWITCH_GREEN),
        # and those agents already perform their own cost-benefit analysis
        # (QP objective / EMA pressure). A second SUMO-side queue check using
        # internal halting counts is redundant in synthetic mode and actively
        # harmful in live-metrics mode where SUMO has sparse spawned vehicles
        # — internal counts are near-zero even while real queues are large,
        # so the gate would block every valid agent switch.
        #
        # Starvation overrides (safety=True) bypass even the too_fresh guard.
        too_fresh     = phase_age < RESPECT_MIN_PHASE_S
        allow_preempt = True
        gate_reason   = "ok"
        if too_fresh and not is_safety:
            allow_preempt = False
            gate_reason = f"phase_too_fresh ({phase_age:.0f}s<{RESPECT_MIN_PHASE_S:.0f}s)"

        _dbg("sumo_runner.py:apply_decision", "setPhase_decision", {
            "hypothesisId":   "H2,H3",
            "camera":         camera_name,
            "action":         action,
            "target_roi":     target_roi,
            "target_tls":     target_tls,
            "current_phase":  current_phase,
            "new_phase":      phase_idx,
            "phase_age_s":    round(phase_age, 2),
            "is_safety":      is_safety,
            "allow_preempt":  allow_preempt,
            "gate_reason":    gate_reason,
            "sim_time":       sim_time_now,
        })

        if not allow_preempt:
            return

        _initiate_clearance_switch(target_tls, current_phase, phase_idx, sim_time_now,
                                   camera_name=camera_name, target_roi=target_roi)
        _tls_apply_lock_step[target_tls] = sim_time_now


def _init_destination_edges():
    global DESTINATION_EDGES
    if DESTINATION_EDGES:
        return
    try:
        with open(MAPPING_FILE) as f:
            full_cam_map = json.load(f)

        xs = [d['sumo_x'] for d in full_cam_map.values()]
        ys = [d['sumo_y'] for d in full_cam_map.values()]

        if not xs:
            center_x = center_y = 5000
            allowed_radius = 5000
        else:
            center_x = (min(xs) + max(xs)) / 2
            center_y = (min(ys) + max(ys)) / 2
            dx = max(xs) - center_x
            dy = max(ys) - center_y
            cluster_radius = math.sqrt(dx ** 2 + dy ** 2)
            allowed_radius = cluster_radius * 1.0

        # Use sumolib to pre-filter to passenger-accessible edges only.
        # This eliminates findRoute errors caused by pedestrian paths, crossings,
        # walkingarea segments, and one-way edges that block DEFAULT_VEHTYPE.
        passenger_ok = None
        try:
            net = sumolib.net.readNet(NET_FILE, withInternal=False)
            passenger_ok = {
                e.getID()
                for e in net.getEdges()
                if e.allows("passenger")
                and e.getFunction() not in ("internal", "crossing", "walkingarea")
                and len(e.getLanes()) > 0
            }
            print(f"sumolib: {len(passenger_ok)} passenger-accessible edges in network.")
        except Exception as se:
            print(f"sumolib passenger filter unavailable ({se}); skipping type filter.")

        all_edges = traci.edge.getIDList()
        valid_edges = []
        for edge in all_edges:
            if edge.startswith(":"):
                continue
            if passenger_ok is not None and edge not in passenger_ok:
                continue
            try:
                lane_0 = edge + "_0"
                shape  = traci.lane.getShape(lane_0)
                if not shape:
                    continue
                start_x, start_y = shape[0]
                dist = math.sqrt((start_x - center_x) ** 2 + (start_y - center_y) ** 2)
                if dist <= allowed_radius:
                    valid_edges.append(edge)
            except Exception:
                continue

        DESTINATION_EDGES = valid_edges
        print(f"Initialized {len(DESTINATION_EDGES)} passenger-accessible destination edges.")
    except Exception as e:
        print(f"Error initializing destination edges: {e}")


def spawn_from_metrics(metrics, cam_mapping, demand_multiplier=1.0):
    global DESTINATION_EDGES
    _init_destination_edges()
    if not DESTINATION_EDGES:
        return

    vehicle_counts = metrics.get("vehicle_counts", {})
    for direction, count in vehicle_counts.items():
        if count <= 0:
            continue
        lanes = cam_mapping.get("lane_map", {}).get(direction.upper(), [])
        if not lanes:
            continue

        # Count vehicles SUMO already has on these lanes (moving + halted).
        # Only spawn the deficit so we don't stack on top of existing vehicles
        # and inflate the simulation beyond what the camera actually sees.
        sumo_count = 0
        for lane in lanes:
            try:
                sumo_count += traci.lane.getLastStepVehicleNumber(lane)
            except Exception:
                pass

        target = int(count * demand_multiplier)
        deficit = target - sumo_count
        if deficit <= 0:
            continue

        # Spawn at most one vehicle per call to avoid sudden large insertions.
        lane_id = random.choice(lanes)
        edge_id = traci.lane.getEdgeID(lane_id)
        try:
            dest_edge = random.choice(DESTINATION_EDGES)
            for _ in range(5):
                if dest_edge != edge_id:
                    break
                dest_edge = random.choice(DESTINATION_EDGES)
        except IndexError:
            dest_edge = edge_id

        veh_id   = f"auto_{int(time.time()*1000)}_{random.randint(0,999)}"
        route_id = f"route_{veh_id}"

        try:
            route_obj   = traci.simulation.findRoute(edge_id, dest_edge,
                                                     vType="car_visual")
            route_edges = route_obj.edges
            if not route_edges:
                continue
            if route_id not in traci.route.getIDList():
                traci.route.add(route_id, route_edges)
            traci.vehicle.add(veh_id, route_id, typeID="car_visual",
                              departPos="free", departSpeed="max")
        except Exception:
            pass


# ==========================
# Synthetic metrics (edge-agent bypass)
# ==========================

# --- Downstream-lane resolution cache ---------------------------------------
# For each (camera, approach) we compute the set of lanes the incoming lanes
# discharge into (one step through the junction). Halting vehicles on those
# outgoing lanes become the "downstream queue" term used by MaxPressure to
# build true pressure = q_upstream - q_downstream. Without this, MaxPressure
# degenerates to Max-Queue and ignores spill-back on the receiving link.
_downstream_lanes_cache: dict = {}


def _downstream_lanes_for_approach(lanes):
    """Return the de-duplicated list of outgoing lanes connected to ``lanes``.

    Uses ``traci.lane.getLinks`` which returns every viable movement from
    the incoming lane. We keep all of them (through + turns) because a
    downstream backup from *any* receiving movement is a valid reason to
    hold the upstream queue.
    """
    out = set()
    for lane in lanes:
        try:
            links = traci.lane.getLinks(lane)
        except Exception:
            continue
        for link in links:
            # link[0] is the junction-internal lane (:junctionid_x).
            # Follow one more hop through it to reach the actual receiving
            # road segment where back-pressure from downstream queues builds.
            try:
                via_lane = link[0]
            except Exception:
                continue
            if not via_lane:
                continue
            if not str(via_lane).startswith(":"):
                # Rare: already a road lane (some TraCI versions return it directly)
                out.add(via_lane)
                continue
            try:
                next_links = traci.lane.getLinks(via_lane)
                for nlink in next_links:
                    road_lane = nlink[0]
                    if road_lane and not str(road_lane).startswith(":"):
                        out.add(road_lane)
            except Exception:
                continue
    return sorted(out)


def synthesize_metrics_for_camera(cam_name, cam_data):
    """Build an EdgeAgent-shaped metrics dict from live SUMO lane state.

    Counts halting vehicles per approach (UP/DOWN/LEFT/RIGHT) directly,
    so the hybrid agent can be benchmarked without MongoDB/edge agents.

    Also computes ``downstream_counts`` so the MaxPressure controller can
    form true pressure (see §3.2 of the review).
    """
    lane_map = cam_data.get("lane_map", {}) or {}
    vehicle_counts = {}
    traffic_metrics = {}
    downstream_counts = {}
    total_vehicles = 0

    # Cache downstream lane mapping once per (camera, approach) — resolving
    # links through TraCI on every step is expensive.
    cache_ns = _downstream_lanes_cache.setdefault(cam_name, {})

    for approach, lanes in lane_map.items():
        if not lanes:
            continue
        halted = 0
        occupancy = 0.0
        mean_speed = 0.0
        n_lanes = 0
        for lane in lanes:
            try:
                halted    += traci.lane.getLastStepHaltingNumber(lane)
                occupancy += traci.lane.getLastStepOccupancy(lane)
                mean_speed += traci.lane.getLastStepMeanSpeed(lane)
                n_lanes += 1
            except Exception:
                continue
        vehicle_counts[approach]  = int(halted)
        traffic_metrics[approach] = {
            "occupancy": float(occupancy / n_lanes) if n_lanes else 0.0,  # per-lane avg
            "mean_speed": float(mean_speed / n_lanes) if n_lanes else 0.0,
        }
        total_vehicles += int(halted)

        # Downstream queue — sum halting on the receiving lanes.
        if approach not in cache_ns:
            cache_ns[approach] = _downstream_lanes_for_approach(lanes)
        d_halted = 0
        for dl in cache_ns[approach]:
            try:
                d_halted += traci.lane.getLastStepHaltingNumber(dl)
            except Exception:
                continue
        downstream_counts[approach] = int(d_halted)

    return {
        "camera_name":     cam_name,
        "vehicle_counts":  vehicle_counts,
        "traffic_metrics": traffic_metrics,
        "downstream_counts": downstream_counts,
        "total_vehicles":  total_vehicles,
        "congestion_levels": {a: ("High" if c > 10 else "Medium" if c > 3 else "Low")
                               for a, c in vehicle_counts.items()},
        "traffic_lights":  [],
    }


def spawn_synthetic_demand(demand_multiplier):
    """Spawn a trickle of vehicles at random valid edges (no Mongo required)."""
    global DESTINATION_EDGES
    if not DESTINATION_EDGES:
        return
    # ~ demand_multiplier vehicles per control second, Poisson-ish
    n_to_spawn = 1 if random.random() < demand_multiplier else 0
    if demand_multiplier > 1.0 and random.random() < (demand_multiplier - 1.0):
        n_to_spawn += 1
    for _ in range(n_to_spawn):
        try:
            origin = random.choice(DESTINATION_EDGES)
            dest   = random.choice(DESTINATION_EDGES)
            if origin == dest:
                continue
            veh_id   = f"syn_{int(time.time()*1000)}_{random.randint(0,9999)}"
            route_id = f"route_{veh_id}"
            route_obj = traci.simulation.findRoute(origin, dest, vType="car_visual")
            edges = route_obj.edges
            if not edges:
                continue
            if route_id not in traci.route.getIDList():
                traci.route.add(route_id, edges)
            traci.vehicle.add(veh_id, route_id, typeID="car_visual",
                              departPos="free", departSpeed="max")
        except Exception:
            pass


# ==========================
# Metrics calculation
# ==========================

_dep_delay_acc: float = 0.0   # cumulative departure delay of completed trips
_dep_delay_n:   int   = 0     # number of completed trips
# Pre-step snapshot of accumulated wait per vehicle. SUMO removes arrived
# vehicles from the network before we can query them post-step, so we
# snapshot their wait times before each simulationStep() and look them up
# in calculate_metrics once getArrivedIDList() tells us who departed.
_pre_step_acc_wait: dict = {}


def _snapshot_accumulated_waits() -> None:
    """Capture each active vehicle's accumulated wait before the sim step."""
    global _pre_step_acc_wait
    try:
        vids = traci.vehicle.getIDList()
        _pre_step_acc_wait = {
            v: traci.vehicle.getAccumulatedWaitingTime(v) for v in vids
        }
    except Exception:
        _pre_step_acc_wait = {}


def calculate_metrics(veh_list, arrived_now, total_arrived):
    global _dep_delay_acc, _dep_delay_n

    total_vehs  = len(veh_list)
    avg_wait    = 0.0
    max_wait    = 0.0
    total_queue = 0

    if total_vehs > 0:
        waits    = [traci.vehicle.getWaitingTime(v) for v in veh_list]
        avg_wait = sum(waits) / total_vehs
        max_wait = max(waits) if waits else 0.0

    total_queue = sum(1 for v in veh_list if traci.vehicle.getSpeed(v) < 0.1)
    new_total   = total_arrived + arrived_now

    # Per-vehicle departure delay: use the pre-step snapshot so we can
    # report the final accumulated wait of vehicles that just exited.
    # getAccumulatedWaitingTime() fails post-step because SUMO removes them.
    try:
        departed_ids = traci.simulation.getArrivedIDList()
        for vid in departed_ids:
            w = _pre_step_acc_wait.get(vid)
            if w is not None:
                _dep_delay_acc += w
                _dep_delay_n   += 1
    except Exception:
        pass
    avg_dep_delay = (_dep_delay_acc / _dep_delay_n) if _dep_delay_n > 0 else 0.0

    return {
        "total_vehicles": total_vehs,
        "avg_wait_time":  round(avg_wait, 2),
        "max_wait_time":  round(max_wait, 2),
        "total_queue":    total_queue,
        "throughput":     new_total,
        "avg_dep_delay":  round(avg_dep_delay, 2),
    }, new_total


# ==========================
# Phase switch counter
# ==========================

_tls_last_phase: dict = {}

def count_phase_switches() -> int:
    switches = 0
    for tls in traci.trafficlight.getIDList():
        try:
            phase = traci.trafficlight.getPhase(tls)
            prev  = _tls_last_phase.get(tls)
            if prev is not None and phase != prev:
                switches += 1
            _tls_last_phase[tls] = phase
        except Exception:
            pass
    return switches


# ==========================
# CSV logger
# ==========================

class CsvLogger:
    def __init__(self, seed: int, demand: str, mode: str):
        Path(RESULTS_DIR).mkdir(parents=True, exist_ok=True)
        fname = os.path.join(RESULTS_DIR, f"{seed}_{demand}_{mode}.csv")
        self._f = open(fname, "w", newline="")
        fields = ["sim_time", "total_vehicles", "avg_wait_time", "max_wait_time",
                  "total_queue", "throughput", "avg_dep_delay", "phase_switches_this_step",
                  "mpc_decisions"]
        self._writer = csv.DictWriter(self._f, fieldnames=fields)
        self._writer.writeheader()
        print(f"Logging results to: {fname}")

    def write(self, row: dict):
        self._writer.writerow(row)

    def close(self):
        self._f.close()


# ==========================
# SCOOT-style cycle adapter
# ==========================

class ScootCycleAdapter:
    """Background green-split optimiser — SCOOT-style, zero clearance overhead.

    Runs independently of the per-camera MaxPressure / MPC agent.  Every
    ``update_interval_s`` it re-measures halting demand on every TLS in the
    network and redistributes the available green time proportionally
    (Webster's simplified split).  Because it only changes *phase durations*
    (never the phase order or state strings), and applies at cycle start
    rather than mid-green:

      * No yellow+all-red clearance penalty — splits take effect at the next
        natural phase boundary.
      * Signal coordination (MAXBAND offsets) is preserved — cycle length is
        kept constant; only the internal split ratio changes.
      * Network-wide coverage — applies to every TLS, not just the ~14 that
        cameras observe.  The camera-level agent then handles real-time
        deviations (emergency preemption) on top of this background plan.

    This is the architectural fix for why pure MaxPressure / MPC couldn't
    beat fixed-time: those controllers preempt mid-cycle (paying clearance
    cost, breaking green waves) while SCOOT modifies the cycle boundary plan.
    """

    def __init__(self,
                 update_interval_s: float = 60.0,
                 min_green_s: float = 8.0,
                 max_green_s: float = 70.0):
        self._interval  = float(update_interval_s)
        self._min_green = float(min_green_s)
        self._max_green = float(max_green_s)
        self._last_update: dict = {}  # tls_id -> sim_time of last successful update

    # ------------------------------------------------------------------
    def update(self, tls_id: str, sim_time: float) -> bool:
        """Try to update one TLS.  Returns True on success."""
        if sim_time - self._last_update.get(tls_id, -9999.0) < self._interval:
            return False
        # Don't touch a TLS mid-clearance (agent preemption in progress).
        if tls_id in _tls_clearance:
            return False
        try:
            return self._apply(tls_id, sim_time)
        except Exception:
            return False

    def _apply(self, tls_id: str, sim_time: float) -> bool:
        logics = traci.trafficlight.getAllProgramLogics(tls_id)
        if not logics:
            return False
        logic  = logics[0]
        phases = list(logic.phases)
        if len(phases) < 2:
            return False

        controlled_lanes = traci.trafficlight.getControlledLanes(tls_id)

        # ---- Classify phases ----
        # Green phase: at least one 'G' (priority green) signal in the state.
        # Clearance phase: yellow ('y') or all-red ('r'/'u') — must NOT be modified.
        green_indices: list = []
        for i, ph in enumerate(phases):
            if 'G' in ph.state:
                green_indices.append(i)

        if len(green_indices) < 2:
            return False  # Only one serviceable direction — nothing to balance.

        # ---- Measure demand per green phase ----
        demands: list = []
        for gi in green_indices:
            state = phases[gi].state
            q = 0.0
            for j, lane in enumerate(controlled_lanes):
                if j < len(state) and state[j] in ('G', 'g'):
                    try:
                        q += traci.lane.getLastStepHaltingNumber(lane)
                    except Exception:
                        pass
            demands.append(max(0.0, q))

        if sum(demands) <= 0:
            # No vehicles anywhere — keep current split, reset timer.
            self._last_update[tls_id] = sim_time
            return False

        # ---- Webster proportional split ----
        total_green = sum(phases[i].duration for i in green_indices)
        if total_green < len(green_indices) * self._min_green:
            return False  # Cycle too short to redistribute safely.

        total_demand = sum(demands)
        raw      = [d / total_demand * total_green for d in demands]
        clamped  = [max(self._min_green, min(self._max_green, g)) for g in raw]
        # Re-scale so the total green budget is exactly preserved (cycle-length neutral).
        scale    = total_green / max(sum(clamped), 1e-6)
        final    = [max(self._min_green, c * scale) for c in clamped]

        # ---- Apply — mutate durations in place, push new logic ----
        for k, idx in enumerate(green_indices):
            phases[idx].duration = round(final[k], 1)

        # Preserve current phase so SUMO doesn't restart the cycle.
        try:
            logic.currentPhaseIndex = traci.trafficlight.getPhase(tls_id)
        except Exception:
            pass
        logic.phases = phases
        traci.trafficlight.setProgramLogic(tls_id, logic)
        self._last_update[tls_id] = sim_time
        return True


# ==========================
# Startup corridor offsets
# ==========================

def _apply_startup_corridor_offsets(camera_map: dict, lane_to_tls: dict) -> None:
    """Compute and apply MAXBAND-style green-wave offsets at simulation start.

    Uses the corridor_config.yaml ordering and euclidean camera distances to
    estimate travel times, then runs the Webster + MAXBAND solver to get the
    optimal per-intersection offset. The result is applied by phase-shifting
    the TLS program at t=0 so green-wave coordination is active immediately,
    not after the corridor planner's 180-second Redis solve interval.

    Gracefully skips if config files are missing or solver dependencies
    (pulp/yaml) are not installed.
    """
    try:
        import yaml
        from coordination.maxband import solve_maxband, webster_cycle
    except ImportError:
        return

    corridor_yaml = os.path.join(BASE_DIR, "corridor_config.yaml")
    if not os.path.exists(corridor_yaml):
        return

    try:
        with open(corridor_yaml) as f:
            corridors_cfg = yaml.safe_load(f) or {}
        corridors = corridors_cfg.get("corridors", {})
    except Exception:
        return

    if not corridors:
        return

    # Build camera position lookup from camera_map
    cam_pos = {name: (d.get("sumo_x", 0.0), d.get("sumo_y", 0.0))
               for name, d in camera_map.items()}

    default_speed_ms = float(os.getenv("HYBRID_PLATOON_SPEED_MS", "13.4"))  # 30 mph

    for cid, cdef in corridors.items():
        cameras = cdef.get("cameras_ordered", [])
        if len(cameras) < 2:
            continue

        # Estimate travel times from Euclidean distance ÷ default speed
        travel_times = []
        for i in range(len(cameras) - 1):
            ax, ay = cam_pos.get(cameras[i],   (0.0, 0.0))
            bx, by = cam_pos.get(cameras[i+1], (0.0, 0.0))
            dist = math.sqrt((bx - ax)**2 + (by - ay)**2)
            travel_times.append(max(dist / default_speed_ms, 1.0))

        # Webster cycle from uniform moderate demand (0.2 veh/s per axis)
        cycle = webster_cycle(
            flows=[0.2, 0.2],
            sat_flows=[0.53, 0.53],
            lost_time=10.0,
        )
        cycle = round(cycle / 5.0) * 5.0  # round to 5s grid

        cam_ids = [c.replace(" & ", "__").replace(" ", "_") for c in cameras]
        green_ratios = [0.5] * len(cameras)  # equal split as startup default

        offsets = solve_maxband(cam_ids, travel_times, green_ratios, cycle)
        if not offsets:
            continue

        # Apply each offset by phase-shifting the TLS at the corresponding camera
        for cam_name, offset_s in offsets.items():
            if offset_s <= 0.5:
                continue  # reference intersection — no shift needed
            # Find the TLS for this camera via its lane_map
            cam_data = camera_map.get(cam_name) or {}
            lane_map = cam_data.get("lane_map", {})
            tls_id = None
            for lanes in lane_map.values():
                for lane in (lanes or []):
                    if lane in lane_to_tls:
                        tls_id = lane_to_tls[lane]
                        break
                if tls_id:
                    break
            if not tls_id:
                continue
            try:
                current_phase = traci.trafficlight.getPhase(tls_id)
                # Shift offset by adjusting the current phase duration so the
                # program is advanced by offset_s within the cycle.
                traci.trafficlight.setPhaseDuration(
                    tls_id, max(1.0, offset_s % max(cycle, 1.0))
                )
                _dbg("sumo_runner.py:_apply_startup_corridor_offsets",
                     "applied_offset",
                     {"corridor": cid, "camera": cam_name,
                      "tls_id": tls_id, "offset_s": offset_s, "cycle": cycle})
            except Exception:
                pass

    print(f"Startup corridor offsets applied for {len(corridors)} corridor(s).")


# ==========================
# Main runner
# ==========================

def run_simulation():
    global _dep_delay_acc, _dep_delay_n, _pre_step_acc_wait
    _dep_delay_acc      = 0.0
    _dep_delay_n        = 0
    _pre_step_acc_wait  = {}
    random.seed(RANDOM_SEED)
    demand_mult = DEMAND_MULTIPLIERS.get(DEMAND_LEVEL, 1.0)

    print(f"Starting SUMO | mode={CONTROLLER_MODE} seed={RANDOM_SEED} demand={DEMAND_LEVEL} profile={DEMAND_PROFILE}")
    print(f"  Net file: {NET_FILE}")

    if not os.path.exists(MAPPING_FILE):
        print("Mapping file not found.")
        return

    with open(MAPPING_FILE) as f:
        camera_map = json.load(f)

    sumo_binary = "sumo" if HEADLESS else "sumo-gui"
    cmd = [sumo_binary, "-n", NET_FILE,
           "--step-length", str(SIM_STEP_LENGTH),
           "--seed", str(RANDOM_SEED),
           "--start"]

    try:
        traci.start(cmd)
    except Exception as e:
        print(f"Failed to start SUMO: {e}")
        return

    traci.simulationStep()

    if "car_visual" not in traci.vehicletype.getIDList():
        traci.vehicletype.copy("DEFAULT_VEHTYPE", "car_visual")
    traci.vehicletype.setShapeClass("car_visual", "passenger")
    try:
        traci.vehicletype.setImgFile("car_visual", "passenger")
    except Exception:
        pass
    traci.vehicletype.setWidth("car_visual", 1.8)
    traci.vehicletype.setLength("car_visual", 4.5)
    traci.vehicletype.setColor("car_visual", (255, 0, 0, 255))

    lane_to_tls = get_lane_to_tls_map()
    print(f"Mapped {len(lane_to_tls)} controlled lanes.")

    # Cache all TLS IDs once for ScootCycleAdapter (avoids per-step getIDList call).
    _all_tls_ids = sorted(set(lane_to_tls.values()))

    # ── Full-coverage TLS agent extension ─────────────────────────────────────
    # Camera-based agent decisions only reach the ~14-20 TLS that have a real
    # camera mapped to them.  Every other TLS in the controlled area runs SUMO's
    # dumb fixed-time plan.  Fix: build a synthetic cam_data for every non-camera
    # TLS within the cluster radius, then run MaxPressure/MPC on all of them
    # every control cycle using live TraCI lane state (zero MongoDB dependency).

    # Step 1: identify TLS already covered by real cameras.
    _camera_tls_ids: set = set()
    for cam_data in camera_map.values():
        for lanes in cam_data.get("lane_map", {}).values():
            for lane in (lanes or []):
                if lane in lane_to_tls:
                    _camera_tls_ids.add(lane_to_tls[lane])

    # Step 2: compute cluster centre + cover radius from camera positions.
    _cam_xs = [d["sumo_x"] for d in camera_map.values()]
    _cam_ys = [d["sumo_y"] for d in camera_map.values()]
    if _cam_xs:
        _cx = (min(_cam_xs) + max(_cam_xs)) / 2
        _cy = (min(_cam_ys) + max(_cam_ys)) / 2
        _cluster_r = math.sqrt(((max(_cam_xs) - _cx) ** 2) + ((max(_cam_ys) - _cy) ** 2))
        _cover_r   = _cluster_r * 1.2   # slightly beyond camera boundary
    else:
        _cx = _cy = 5000.0
        _cover_r  = 5000.0

    # Step 3: for every non-camera TLS within the cover radius, build a
    # lane_map keyed by phase label ("G{i}") so synthesize_metrics_for_camera
    # and apply_decision work without modification.
    _tls_cam_data_cache: dict = {}
    agent_tmp = _load_agent(CONTROLLER_MODE)  # probe: None for fixed_time
    if agent_tmp is not None:
        for _tls_id in _all_tls_ids:
            if _tls_id in _camera_tls_ids:
                continue
            try:
                _cl = traci.trafficlight.getControlledLanes(_tls_id)
                if not _cl:
                    continue
                # Spatial filter — only instrument TLS inside the cover radius.
                _sh = traci.lane.getShape(_cl[0])
                if not _sh:
                    continue
                _lx, _ly = _sh[0]
                if math.sqrt((_lx - _cx) ** 2 + (_ly - _cy) ** 2) > _cover_r:
                    continue
                _logic  = traci.trafficlight.getAllProgramLogics(_tls_id)[0]
                _phases = _logic.phases
                _lmap   = {}
                for _pi, _ph in enumerate(_phases):
                    if "G" not in _ph.state and "g" not in _ph.state:
                        continue
                    _glanes = list(dict.fromkeys(
                        _cl[_j]
                        for _j in range(min(len(_ph.state), len(_cl)))
                        if _ph.state[_j] in ("G", "g")
                    ))
                    if _glanes:
                        _lmap[f"G{_pi}"] = _glanes
                # Need ≥ 2 distinct green phases to have anything to balance.
                if len(_lmap) >= 2:
                    _tls_cam_data_cache[_tls_id] = {"lane_map": _lmap}
            except Exception:
                continue
    print(f"Coverage extension: {len(_tls_cam_data_cache)} additional TLS under agent control "
          f"(camera TLS: {len(_camera_tls_ids)}, total in area: "
          f"{len(_camera_tls_ids) + len(_tls_cam_data_cache)}).")

    # Apply corridor offsets immediately at startup using Webster-sized defaults.
    # The corridor planner (coordination/planner.py) re-solves every 180s via
    # Redis, but in benchmarks that's too late. We seed the offsets here from
    # camera distances so green-wave coordination is active from t=0.
    _apply_startup_corridor_offsets(camera_map, lane_to_tls)

    # SCOOT-style background cycle adapter — active for hybrid mode only.
    # It redistributes green splits network-wide every 60s at zero clearance cost,
    # then the per-camera MaxPressure/MPC agent handles real-time deviations on top.
    _scoot = ScootCycleAdapter(update_interval_s=60.0) if CONTROLLER_MODE == "hybrid" else None
    if _scoot:
        print("ScootCycleAdapter enabled (60s background split optimisation).")

    for name, data in camera_map.items():
        try:
            traci.poi.add(name, data['sumo_x'], data['sumo_y'],
                          (0, 255, 255, 255), poiType="camera", layer=100)
        except Exception:
            pass

    if camera_map and not HEADLESS:
        first_cam = list(camera_map.values())[0]
        try:
            traci.gui.setOffset("View #0", first_cam['sumo_x'], first_cam['sumo_y'])
            traci.gui.setZoom("View #0", 2000)
        except Exception:
            pass

    # MongoDB (for reading real edge-agent metrics). Skipped in synthetic mode.
    if SYNTHETIC_METRICS:
        metrics_col = None
        print("SYNTHETIC_METRICS=1 -> skipping MongoDB; building metrics from SUMO directly.")
    else:
        try:
            client      = MongoClient(MONGO_URI)
            db          = client[DB_NAME]
            metrics_col = db[METRICS_COL]
            print("Connected to MongoDB.")
        except Exception as e:
            print(f"Failed to connect to MongoDB: {e}")
            metrics_col = None

    agent   = _load_agent(CONTROLLER_MODE)
    logger  = CsvLogger(RANDOM_SEED, DEMAND_LEVEL, CONTROLLER_MODE)

    last_control_time = 0
    total_arrived     = 0
    cumulative_switches = 0

    if SYNTHETIC_METRICS or SYNTHETIC_DEMAND:
        _init_destination_edges()

    # #region agent log
    _dbg_wall_start = time.time()
    _dbg_last_wall  = _dbg_wall_start
    _dbg_total_tls  = len(traci.trafficlight.getIDList())
    _dbg("sumo_runner.py:run_simulation", "startup", {
        "hypothesisId": "H1,H5",
        "mode":              CONTROLLER_MODE,
        "seed":              RANDOM_SEED,
        "demand":            DEMAND_LEVEL,
        "sim_step":          SIM_STEP_LENGTH,
        "control_int":       CONTROL_INTERVAL,
        "headless":          HEADLESS,
        "synthetic_metrics": SYNTHETIC_METRICS,
        "synthetic_demand":  SYNTHETIC_DEMAND,
        "total_tls_net":     _dbg_total_tls,
        "num_cameras":       len(camera_map),
        "destination_edges": len(DESTINATION_EDGES),
    })
    # #endregion

    print(f"Simulation started (max {SIM_DURATION_S}s). Ctrl+C to stop.")

    try:
        while True:
            time.sleep(0.05)
            _snapshot_accumulated_waits()   # must precede simulationStep()
            traci.simulationStep()
            sim_time = traci.simulation.getTime()

            if sim_time >= SIM_DURATION_S:
                print(f"Reached simulation duration ({SIM_DURATION_S}s). Stopping.")
                break

            if sim_time - last_control_time >= CONTROL_INTERVAL:
                switches_this_step = count_phase_switches()
                cumulative_switches += switches_this_step

                # Commit any deferred clearances before running agent decisions,
                # so the agent sees the up-to-date TLS phase.
                _service_pending_clearances(sim_time)

                # Direct SUMO-native queue preemption — independent of agent/metrics.
                # Switches any TLS where the current green is idle but another phase
                # has a large queue, regardless of what the camera pipeline reports.
                _direct_queue_preemption(sim_time, _all_tls_ids)

                # SCOOT background cycle adaptation — runs on ALL TLS every 60s,
                # adjusting green splits proportional to measured demand.
                # Zero clearance overhead; preserves corridor coordination.
                if _scoot is not None:
                    for _tid in _all_tls_ids:
                        _scoot.update(_tid, sim_time)

                # #region agent log
                _now_wall = time.time()
                _dbg_docs_count = 0
                # #endregion

                # --- Agent decisions ---
                mpc_decisions_this_step = 0
                if agent is not None and SYNTHETIC_METRICS:
                    # Synthetic benchmark: derive metrics directly from SUMO
                    # (bypasses MongoDB / edge-agent pipeline).
                    try:
                        _dbg_docs_count = len(camera_map)
                        for cam_name, cam_data in camera_map.items():
                            metrics = synthesize_metrics_for_camera(cam_name, cam_data)
                            if metrics["total_vehicles"] == 0 and not any(metrics["vehicle_counts"].values()):
                                # No vehicles present at this camera yet — skip the
                                # agent call but still drive demand into the network
                                # so the benchmark can bootstrap.
                                if SYNTHETIC_DEMAND:
                                    _prof = _profile_counts(sim_time)
                                    mock_metrics = {
                                        "camera_name":    cam_name,
                                        "vehicle_counts": {k: int(v * demand_mult) for k, v in _prof.items()},
                                        "total_vehicles": int(sum(_prof.values()) * demand_mult),
                                    }
                                    spawn_from_metrics(mock_metrics, cam_data, demand_mult)
                                continue
                            # #region agent log
                            metrics["_sim_time"] = sim_time
                            # #endregion
                            decision = agent.decide(metrics)
                            if decision.get("mode") == "mpc":
                                mpc_decisions_this_step += 1
                            apply_decision(decision, cam_data, lane_to_tls, cam_name)
                            # Same demand shape fixed_time uses — per-camera mock —
                            # so cross-mode comparisons are apples-to-apples.
                            if SYNTHETIC_DEMAND:
                                _prof = _profile_counts(sim_time)
                                mock_metrics = {
                                    "camera_name":    cam_name,
                                    "vehicle_counts": {k: int(v * demand_mult) for k, v in _prof.items()},
                                    "total_vehicles": int(sum(_prof.values()) * demand_mult),
                                }
                                spawn_from_metrics(mock_metrics, cam_data, demand_mult)
                    except Exception as e:
                        print(f"Synthetic loop error: {e}")
                        _dbg("sumo_runner.py:run_simulation", "synthetic_loop_error",
                             {"error": str(e), "sim_time": sim_time})

                elif agent is not None and metrics_col is not None:
                    pipeline = [
                        {"$sort": {"timestamp": -1}},
                        {"$group": {
                            "_id":    "$camera_name",
                            "latest": {"$first": "$$ROOT"},
                        }},
                    ]
                    try:
                        results = list(metrics_col.aggregate(pipeline))
                        # #region agent log
                        _dbg_docs_count = len(results)
                        # #endregion
                        for doc in results:
                            metrics  = doc.get("latest", {})
                            cam_name = metrics.get("camera_name")
                            if not cam_name or cam_name not in camera_map:
                                continue
                            # #region agent log
                            metrics["_sim_time"] = sim_time  # for safety/mode_selector to see
                            # #endregion
                            decision = agent.decide(metrics)
                            apply_decision(decision, camera_map[cam_name], lane_to_tls, cam_name)
                            spawn_from_metrics(metrics, camera_map[cam_name], demand_mult)
                    except Exception as e:
                        print(f"Loop error: {e}")

                elif agent is None:
                    # fixed_time: just spawn from mock data
                    for cam_name, cam_data in camera_map.items():
                        _prof = _profile_counts(sim_time)
                        mock_metrics = {
                            "camera_name":     cam_name,
                            "vehicle_counts":  {k: int(v * demand_mult) for k, v in _prof.items()},
                            "congestion_levels": {k: "Medium" for k in _prof},
                            "total_vehicles":  int(sum(_prof.values()) * demand_mult),
                            "traffic_lights":  [],
                        }
                        spawn_from_metrics(mock_metrics, cam_data, demand_mult)

                # ── Coverage extension: MaxPressure/MPC on every non-camera TLS ──
                # Runs regardless of SYNTHETIC_METRICS flag — always reads live
                # TraCI state so every instrumented intersection gets adaptive
                # control, not just the ~14-20 with real cameras.
                if agent is not None and _tls_cam_data_cache:
                    for _ext_tls, _ext_cam_data in _tls_cam_data_cache.items():
                        if _ext_tls in _tls_clearance:
                            continue
                        try:
                            _ext_cam_name = f"__tls_{_ext_tls}"
                            _ext_metrics  = synthesize_metrics_for_camera(
                                _ext_cam_name, _ext_cam_data)
                            if not any(_ext_metrics["vehicle_counts"].values()):
                                continue
                            _ext_metrics["_sim_time"] = sim_time
                            _ext_decision = agent.decide(_ext_metrics)
                            if _ext_decision.get("mode") == "mpc":
                                mpc_decisions_this_step += 1
                            apply_decision(_ext_decision, _ext_cam_data,
                                           lane_to_tls, _ext_cam_name)
                        except Exception:
                            pass

                # --- Compute + log SUMO metrics ---
                arrived_now = traci.simulation.getArrivedNumber()
                veh_list    = traci.vehicle.getIDList()
                sim_metrics, total_arrived = calculate_metrics(veh_list, arrived_now, total_arrived)

                logger.write({
                    "sim_time":                sim_time,
                    "total_vehicles":          sim_metrics["total_vehicles"],
                    "avg_wait_time":           sim_metrics["avg_wait_time"],
                    "max_wait_time":           sim_metrics["max_wait_time"],
                    "total_queue":             sim_metrics["total_queue"],
                    "throughput":              total_arrived,
                    "avg_dep_delay":           sim_metrics["avg_dep_delay"],
                    "phase_switches_this_step": switches_this_step,
                    "mpc_decisions":           mpc_decisions_this_step,
                })

                # #region agent log
                _wall_dt = _now_wall - _dbg_last_wall
                _dbg_last_wall = _now_wall
                _dbg("sumo_runner.py:run_simulation", "control_cycle", {
                    "hypothesisId":     "H1,H5",
                    "sim_time":         sim_time,
                    "wall_elapsed":     round(_now_wall - _dbg_wall_start, 3),
                    "wall_dt_since_last_cycle": round(_wall_dt, 4),
                    "sim_dt_since_last_cycle":  round(sim_time - last_control_time, 3),
                    "mongo_docs":       _dbg_docs_count,
                    "phase_switches_this_step": switches_this_step,
                    "total_tls_net":    _dbg_total_tls,
                    "throughput":       total_arrived,
                })
                # #endregion

                # --- POST metrics to master API (for dashboard) ---
                try:
                    payload = {**sim_metrics, "sim_time": sim_time}
                    requests.post(f"{MASTER_API_URL}/api/sumo-metrics",
                                  json=payload, timeout=0.1)
                except Exception:
                    pass

                # --- Poll overrides ---
                try:
                    resp = requests.get(f"{MASTER_API_URL}/api/status", timeout=0.1)
                    if resp.status_code == 200 and agent is not None:
                        overrides = resp.json().get("active_overrides", {})
                        for cam_name, details in overrides.items():
                            fake = {
                                "action":     details.get("action"),
                                "target_roi": details.get("target_roi"),
                            }
                            if cam_name in camera_map:
                                apply_decision(fake, camera_map[cam_name], lane_to_tls, cam_name)
                except Exception:
                    pass

                last_control_time = sim_time

    except KeyboardInterrupt:
        print("Interrupted.")
    except traci.FatalTraCIError:
        print("TraCI disconnected.")
    except Exception as e:
        print(f"Runtime error: {e}")
    finally:
        logger.close()
        try:
            traci.close()
        except Exception:
            pass
        print(f"Simulation closed. Total throughput: {total_arrived} vehicles.")


if __name__ == "__main__":
    run_simulation()
