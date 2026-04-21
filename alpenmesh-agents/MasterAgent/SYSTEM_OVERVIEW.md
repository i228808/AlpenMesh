# AlpenMesh Master Agent — System Overview

> Prepared for FYP presentation slides.  
> Location: `alpenmesh-agents/MasterAgent/`

---

## 1. What Is AlpenMesh?

AlpenMesh is an **adaptive traffic signal control system** for a real Seattle road network.  
It replaces static fixed-time signal plans with an AI-driven pipeline that observes live camera feeds, decides which approach to give green, and measures whether that decision actually reduced queues 45 seconds later.

**Two independent pipelines share the same decision engine:**

| Pipeline | Data source | Purpose |
|---|---|---|
| **Live (EdgeAgent)** | Real SDOT CCTV cameras | Production-grade traffic control |
| **SUMO Simulation** | Synthetic demand model | Benchmarking & development |

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  REAL WORLD                   SUMO SIMULATION                       │
│                                                                     │
│  39 SDOT cameras              seattlecity.net.xml                   │
│       │                       sumo_runner.py                        │
│  Rust EdgeAgent                     │                               │
│  (alpenmesh-edge-scheduler)   Synthetic demand profiles             │
│       │                             │                               │
│  MongoDB                      POST /decision (HTTP)                 │
│  traffic_metrics ◄────────────────────────────────                  │
│       │                                                             │
│  ingest_worker.py  (change stream → Redis)                          │
│       │                                                             │
│  Redis  ◄─── feat:{intersection}:{approach}:{movement}             │
│       │                                                             │
│  decision_worker.py  (pub/sub → AI → pub/sub)                       │
│       │                                                             │
│  ┌────┴──────────────────────────────────────────┐                  │
│  │         DECISION PIPELINE                     │                  │
│  │  SafetyWrapper                                │                  │
│  │    └─ ModeSelector                            │                  │
│  │         ├─ MPC Agent (cvxpy / ECOS)           │                  │
│  │         └─ MaxPressure Agent                  │                  │
│  └────────────────────────────────────────────────┘                 │
│       │                                                             │
│  Redis decisions:{intersection}                                     │
│       │                                                             │
│  outcome_worker.py  (45s feedback loop → MongoDB)                   │
│       │                                                             │
│  FastAPI (:8000)  ←→  Operator Control Dashboard (:5173)            │
│                                                                     │
│  Corridor Planner  ←  MAXBAND + Webster every 3 min                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Pipeline — EdgeAgent → Master

### 3.1 EdgeAgent (Rust)

- Runs alongside each camera group on an edge device
- Reads `cameras.json` (39 SDOT cameras) for stream URLs
- Calls YOLO / computer-vision models to count vehicles per ROI region
- Writes results into MongoDB `traffic_metrics` collection

**ROI naming convention (camera-perspective):**

| ROI name | Traffic direction | SUMO compass |
|---|---|---|
| `down` | toward camera | South (S) |
| `up` | away from camera | North (N) |
| `left` | left of camera | West (W) |
| `right` | right of camera | East (E) |
| `bus` | bus lane | South (S) |
| `intersection` / `int` | zone centre | skipped (None) |

### 3.2 Ingest Worker (`services/ingest_worker.py`)

Opens a **MongoDB change stream** (requires replica set `rs0`) on `traffic_metrics`.  
For every new document it:

1. Resolves each ROI name → `(intersection_id, approach, movement)` via `RoiMapper`
2. Computes **arrival rate** from occupancy delta:

```
arrival_rate = (occupancy_now − occupancy_prev) / Δt
```

3. Writes feature hash to Redis:

```
feat:{intersection_id}:{approach}:{movement}
  → occupancy, mean_dwell_sec, stalled_count, slow_throughput, arrival_rate
  TTL: 30 s
```

4. Appends to a 10-minute sliding history sorted-set: `hist:{intersection}:{approach}:{movement}`
5. Publishes `updates:{corridor}` → wakes the decision worker

**Feature TTL of 30 s** ensures stale data from a disconnected camera cannot drive decisions.

---

## 4. Decision Worker (`services/decision_worker.py`)

Subscribes to Redis pub/sub channel `updates:*`.

For every corridor update:
1. **Check operator override** — if `override:{camera}` key exists in Redis and has not expired, use the override action verbatim (bypasses AI entirely)
2. **Load features** from `feat:*` keys for all 4 cardinal approaches × 3 movements
3. **Check incidents** — reads `incidents:active` set; notifies ModeSelector
4. **Call agent chain** → `SafetyWrapper → ModeSelector → MPC | MaxPressure`
5. **Publish** decision to `decisions:{intersection_id}`
6. **Cache** last decision: `last_decision:{intersection_id}` (TTL 60 s)
7. **Persist** to MongoDB `master_decisions` collection

---

## 5. Decision Pipeline — Agent Stack

The agents form a **layered stack**. Each layer can veto or override the one below.

```
          operator override  ← highest priority
                │
         SafetyWrapper       ← hard physical constraints
                │
          ModeSelector       ← routes to MPC or MaxPressure
           ┌───┴───┐
          MPC   MaxPressure  ← optimization algorithms
```

---

### 5.1 SafetyWrapper (`agents/safety.py`)

The **mandatory outer layer**. Runs on every cycle before any optimizer sees the data.  
Enforces IRL traffic-engineering rules that cannot be violated:

| Guard | Threshold | Trigger |
|---|---|---|
| MIN_GREEN | 6 s | Never switch before minimum green elapsed |
| MAX_GREEN | 60 s | Force a switch; route to highest-queue alternative |
| MAX_WAIT | 90 s | Any approach starved this long wins immediately |
| Pedestrian MIN | 15 s | Raised from 6 s when ped call is active (MUTCD 4E.06) |

**Clearance sequence** (executed at TraCI layer in SUMO, not here):

```
Yellow: 3 s  →  All-Red: 2 s  →  New Green
```
Total clearance cost = **5 s × saturation flow ≈ 2.5 vehicle-equivalents** per switch.

The wrapper also **enriches** metrics before passing them down:
- `_current_approach` — which approach is currently green
- `_phase_elapsed` — seconds since that green started

---

### 5.2 ModeSelector (`agents/mode_selector.py`)

Routes each intersection decision to either MPC or MaxPressure, per cycle.

**Selection rules (evaluated in order):**

```
Rule 1: Active incident on any approach?
        → MaxPressure  (reason: incident_active)

Rule 2: Forecast MAPE > 40% over last 15 min?
        → MaxPressure  (reason: high_mape)

Rule 3: MPC demoted after ≥2 consecutive solver failures?
        → MaxPressure  (reason: mpc_demoted; duration: 60 s)

Rule 4: Otherwise
        → MPC          (reason: mpc_optimal)
```

MAPE = **Mean Absolute Percentage Error** of the HoltPredictor vs actual arrivals.

---

### 5.3 MPC Agent (`agents/mpc.py`)

**Model Predictive Control** — receding-horizon quadratic program.

#### Problem formulation

**State:** queue length per approach `q[t, a]` (vehicle-equivalents)  
**Decision:** green fraction per (step, approach) `g[t, a] ∈ [0, 1]`  
**Horizon:** H = 6 steps × 5 s/step = **30 s lookahead**

**Queue dynamics (state transition):**

```
q[t+1, a] = q[t, a] + λ[t, a] − s · Δt · g[t, a]
```

Where:
- `λ[t, a]` = arrival forecast for approach `a` at step `t` (vehicles/step)
- `s` = saturation flow = **0.5 veh/s/lane** (1800 veh/h)
- `Δt` = step length = 5 s

**Constraints:**

```
q[0, a]   = q₀[a]          (initial condition)
Σ_a g[t]  ≤ 1              (one phase at a time)
g[t, a]   ∈ [0, 1]         ∀ t, a
q[t, a]   ≥ 0              ∀ t, a
```

**Objective — minimise:**

```
J = Σ_{t=1}^{H} Σ_a q[t,a]²           (queue squared — equity cost)
  + λ_sw · Σ_{t=1}^{H-1} |g[t] − g[t-1]|   (switch penalty = 2.0)
  + λ_cur · |g[0] − e_current|         (current-phase clearance cost = 4.0)
  + μ · max_a q[H, a]                  (equity: penalise maximum final queue, μ=1.5)
```

`e_current` = one-hot vector of the currently-served approach (from SafetyWrapper).  
`λ_cur = 4.0` encodes: 5 s clearance × 0.5 sat_flow × 1.6 safety margin ≈ 4 veh-equiv.

**Solver:** ECOS (interior point) with SCS fallback.  
**Budget:** 150 ms p99. If 2 consecutive failures → **demoted** to MaxPressure for 60 s.

**Minimum commitment short-circuit:**

```
if phase_elapsed < MIN_COMMIT_S (6 s):
    skip solver → return HOLD current approach
```

**Platoon injection** (from corridor planner):  
Upstream offsets can inject expected arrivals into `λ[step, approach]`, so MPC anticipates a platoon before it arrives.

---

### 5.4 MaxPressure Agent (`agents/maxpressure.py`)

Based on **Varaiya (2013)** — provably maximises throughput under any bounded arrival rate.

**True pressure (Varaiya):**

```
P(a) = q_upstream(a) − q_downstream(a)
```

Prevents switching to an approach whose downstream link is already backed up (spill-back).

**EMA-smoothed pressure:**

```
P̂[t](a) = (1 − α) · P̂[t-1](a) + α · P_raw(a)     α = 0.35
```

Raw observations drop to zero the instant a phase turns green. EMA prevents this from immediately triggering a switch.

**Occupancy → vehicle-equivalent scaling:**

```
if occupancy ∈ [0, 1]:   raw(a) = occupancy × 20   (per-lane average × 20 veh capacity)
else:                     raw(a) = occupancy / 5
```

**Platoon boost** (from corridor planner):

```
P̂(a) += PLATOON_WEIGHT × platoon_veh(a)     PLATOON_WEIGHT = 1.5
```

**Pedestrian calls:**

```
P̂(a) += PED_WEIGHT × ped_count(a)           PED_WEIGHT = 0.8
```

**Decision rules (in priority order):**

| Condition | Action |
|---|---|
| `phase_elapsed < MIN_COMMIT_S` (6 s) | Hold current — honour minimum commitment |
| Starvation: any approach unserved > 75 s | Force that approach immediately |
| `cur_pressure > DRAIN_THRESH` (1.0) AND `phase_elapsed < MAX_COMMIT_S` (45 s) | Keep draining unless challenger beats incumbent by **×1.3 ratio AND +2 veh** |
| Current drained OR `phase_elapsed ≥ MAX_COMMIT_S` | Rotate to highest-pressure alternative |

**Hysteresis gate (prevents churn):**

```
switch only if:  P̂(challenger) > P̂(current) × 1.3
            AND  P̂(challenger) > P̂(current) + 2.0 veh
```

---

### 5.5 Hybrid Orchestrator (`agents/hybrid_orchestrator.py`)

Wraps ModeSelector. Adds **corridor coordination** on top:

- Reads `corridor:{id}:offsets` from Redis (published by Corridor Planner)
- Injects platoon boost/spike into MaxPressure and MPC metrics
- Makes the per-intersection optimizer corridor-aware without coupling it

---

## 6. Arrival Forecasting — Holt's Double Exponential Smoothing

Used to generate `λ[t, a]` arrival forecasts for MPC.

**Holt's DES equations:**

```
L_t = α · x_t + (1 − α) · (L_{t-1} + T_{t-1})     (level)
T_t = β · (L_t − L_{t-1}) + (1 − β) · T_{t-1}     (trend)

F_{t+h} = max(0,  L_t + h · T_t)                   (h-step ahead forecast)
```

Parameters: **α = 0.3** (level smoothing), **β = 0.1** (trend damping)

**MAPE tracking:**

```
MAPE = (1/N) Σ |actual − forecast| / actual × 100%
```

If MAPE > 40% over the last 15 min, ModeSelector falls back to MaxPressure (forecasts unreliable).

A **PredictorRegistry** maintains one HoltPredictor per `(camera_name, direction)` pair, thread-safely.

---

## 7. Corridor Coordination — MAXBAND + Webster

### 7.1 Webster's Optimal Cycle Length

Given flows `f_i` and saturation flows `s_i` for each phase `i`:

```
Y   = Σ_i (f_i / s_i)                    (sum of flow ratios)
C*  = (1.5 · L + 5) / (1 − Y)            (Webster 1958)
C   = clamp(C*, 60 s, 180 s)
```

`L` = total lost time per cycle (startup + clearance) ≈ **10 s** for a 2-phase intersection.

The planner computes a **Webster cycle independently per intersection** then takes the maximum across the corridor as the common cycle `C`.

### 7.2 MAXBAND Offset Optimization (`coordination/maxband.py`)

Finds signal **offsets** `θ_i ∈ [0, C)` for each intersection in a corridor to maximise the **bandwidth** of a progression band that lets a platoon travel the corridor without stopping (both directions simultaneously).

**Decision variables:**
- `b` = band width (fraction of C) — **objective: maximise `b`**
- `θ_i` = offset fraction for intersection `i`
- `m_fwd_i`, `m_bwd_i` = integer wrapping variables

**Forward band constraint (link i → i+1):**

```
(θ_{i+1} − θ_i − t_{ij}) + m_fwd_i  ≥  b/2 − (1 − g_{i+1})/2
(θ_{i+1} − θ_i − t_{ij}) + m_fwd_i  ≤  (1 − g_i)/2 − b/2
```

**Backward band constraint (link i+1 → i):**

```
(θ_i − θ_{i+1} − t_{ij}) + m_bwd_i  ≥  b/2 − (1 − g_i)/2
(θ_i − θ_{i+1} − t_{ij}) + m_bwd_i  ≤  (1 − g_{i+1})/2 − b/2
```

Where `t_{ij} = travel_time_{ij} / C` (normalised travel time between intersections).

Solved with **PuLP + CBC** (MILP solver, MIT-licensed). Reference: θ₀ = 0 (first intersection is the phase reference).

**Travel time estimation:**

```
speed = DEFAULT_SPEED × (1 − min(mean_dwell / 30, 0.7))   if mean_dwell > 2 s
      = 13.4 m/s (30 mph)                                   otherwise

travel_time = block_distance_m / speed
```

**Trigger conditions (re-solve):**
- Every 3 minutes (fixed interval), OR
- Any link travel time changed by ≥ 15%

**Output:** published to Redis as `corridor:{id}:plan` and `corridor:{id}:offsets`.

---

## 8. Outcome Worker — Feedback Loop (`services/outcome_worker.py`)

Closes the control loop: measures whether decisions actually helped.

**Process:**
1. Subscribes to `decisions:*` pub/sub
2. For each decision, schedules a measurement **45 seconds later** (async task)
3. At T+45s: reads current occupancy from `feat:{intersection}:*` Redis keys
4. Computes:

```
Δqueue = Σ_a occupancy_post(a) − Σ_a occupancy_pre(a)
reward = −Δqueue            (negative queue delta = good)
```

5. Updates the MongoDB `master_decisions` document: `{outcome: {...}, outcome_recorded_at: ...}`
6. Appends `(state, action, reward, next_state)` tuple to:
   - Redis list `exp:buffer` (max 100,000 entries, FIFO)
   - MongoDB `experience` collection (permanent audit trail)

This experience buffer is the foundation for future **offline RL** training.

---

## 9. SUMO Simulation (`sumo_runner.py`)

Used for benchmarking and development. **Completely independent** from the EdgeAgent pipeline.

### 9.1 Network

- **File:** `seattlecity.net.xml` — real Seattle downtown road network (OSM-derived)
- **Coverage:** 1st Ave through 8th Ave, Yesler Way to Stewart St
- **TLS count:** ~35 signalised intersections
- **Camera mapping:** `camera_mapping.json` — maps each camera to SUMO TLS ID + lane IDs

### 9.2 Synthetic Demand Profiles

SUMO generates traffic by inserting vehicles. Demand profiles (`_profile_counts()`):

| Profile | Characteristic | Peak rate |
|---|---|---|
| `light` | Off-peak baseline | ~200 veh/h |
| `moderate` | Typical day | ~500 veh/h |
| `heavy` | Rush hour | ~900 veh/h |
| `bursty` | Irregular spikes (stress test) | Random ×0–3 |

### 9.3 Controller Modes (benchmarked)

| Mode | Description |
|---|---|
| `fixed_time` | SUMO native fixed-time plans — baseline |
| `hybrid` | SafetyWrapper → ModeSelector → MPC / MaxPressure |
| `mpc` | SafetyWrapper → MPC only |
| `maxpressure` | SafetyWrapper → MaxPressure only |
| `rule_based` | Demand-score Tier-1 / Tier-2 heuristic |

### 9.4 Phase Preemption and Cooldown

After each agent-initiated switch, the TLS enters a **preemption cooldown**:

```
cooldown_duration = max(PREEMPT_COOLDOWN_FLOOR_S, program_cycle_s × SCALE)
                  = 45 s  (floor)
```

During cooldown, SUMO's native schedule runs the cross-street phase.  
**Emergency preemption** can break cooldown if:

```
P(waiting) > P(current) × 1.15  AND  P(waiting) > P(current) + 1.0 veh
```

### 9.5 Phase Extension (SCOOT-style, disabled by default)

```
EXTEND_NEAR_END_S = 0   ← disabled
```

When non-zero: if the agent requests PRIORITIZE on the current green AND queue ≥ 3 veh AND phase is near its end → extend by `EXTEND_STEP_S = 3 s` (capped at `EXTEND_MAX_PHASE_S = 35 s`).

Disabled because phase extension disrupts coordinated green-wave timing (serves only camera-observed NS approaches, starves EW). Webster + MAXBAND are the correct cycle-adaptation mechanism.

### 9.6 Output Metrics (per simulation step)

Written to `results/{seed}_{demand}_{mode}.csv`:

| Column | Description |
|---|---|
| `step` | Simulation time (s) |
| `throughput` | Cumulative vehicles arrived |
| `avg_wait` | Mean wait time (s) |
| `max_wait` | Maximum wait time (s) |
| `total_queue` | Total halted vehicles |
| `decisions_made` | Cumulative agent decisions |

---

## 10. REST API (`services/api.py`)

FastAPI on `http://localhost:8000`.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness check + Redis/MongoDB status |
| `/api/live` | GET | Live camera states (Redis feat keys) |
| `/api/status` | GET | Active overrides + simulation running flag |
| `/api/decisions` | GET | Recent decisions from MongoDB |
| `/api/metrics` | GET | Per-camera metrics (3-tier fallback) |
| `/api/override` | POST | Set / clear operator override |
| `/api/simulation/status` | GET | SUMO process status + PID |
| `/api/simulation/start` | POST | Launch sumo_runner subprocess |
| `/api/simulation/stop` | POST | Terminate SUMO |
| `/api/sumo-metrics` | GET/POST | SUMO live metrics cache |
| `/decision` | POST | Direct decision endpoint (used by SUMO runner) |

**Override mechanism:**

```
POST /api/override  {camera_name, action, target_roi, duration}
→ sets Redis key: override:{camera_name}
   value: {action, target_roi, expires_at = now + duration}
   TTL: 3600 s
```

Decision worker checks this key before calling any AI agent.

**3-tier `/api/metrics` fallback:**

```
Tier 1: Redis feat:{intersection}:* keys   (live EdgeAgent, < 30 s old)
Tier 2: MongoDB master_decisions            (last 30 s, SUMO mode)
Tier 3: MongoDB traffic_metrics            (historical fallback)
```

---

## 11. System Parameters Summary

### MPC

| Parameter | Value | Meaning |
|---|---|---|
| `MPC_HORIZON_STEPS` | 6 | Lookahead steps |
| `MPC_STEP_S` | 5 s | Step duration |
| `MPC_SAT_FLOW` | 0.5 veh/s | Saturation flow per lane |
| `MPC_SWITCH_PENALTY` | 2.0 | Inter-step switch cost |
| `MPC_CURRENT_SWITCH_PENALTY` | 4.0 | Clearance cost (t=0) |
| `MPC_EQUITY_WEIGHT` | 1.5 | Max-queue penalty weight |
| `MPC_SOLVE_TIMEOUT` | 150 ms | Solver time budget |
| `MPC_MIN_COMMIT_S` | 6 s | Skip solver below this phase age |

### MaxPressure

| Parameter | Value | Meaning |
|---|---|---|
| `MP_MIN_COMMIT_S` | 6 s | Minimum phase commitment |
| `MP_MAX_COMMIT_S` | 45 s | Starvation backstop |
| `MP_EMA_ALPHA` | 0.35 | Pressure smoothing factor |
| `MP_HYST_RATIO` | 1.30 | Challenger must beat incumbent by ×1.3 |
| `MP_HYST_VEH` | 2.0 veh | Challenger must beat by +2 veh |
| `MP_STARVATION_S` | 75 s | Force-serve if unserved this long |
| `MP_PLATOON_WEIGHT` | 1.5 | Corridor platoon boost weight |
| `MP_PED_WEIGHT` | 0.8 | Pedestrian call weight (veh-equiv) |

### Safety

| Parameter | Value |
|---|---|
| `MIN_GREEN_S` | 6 s |
| `MAX_GREEN_S` | 60 s |
| `MAX_WAIT_PER_AXIS_S` | 90 s |
| `YELLOW_S` | 3 s |
| `ALL_RED_S` | 2 s |
| `PED_MIN_S` | 15 s |

### Corridor Planner

| Parameter | Value |
|---|---|
| `CORRIDOR_SOLVE_INTERVAL_S` | 180 s (3 min) |
| `CORRIDOR_SPEED_CHANGE_PCT` | 15% (trigger re-solve) |
| `SAT_FLOW_PER_GROUP` | 0.53 veh/s |
| `LOST_TIME_S` | 10 s |
| Webster cycle range | 60 – 180 s |

---

## 12. Camera & Network Coverage

- **39 cameras** covering Seattle downtown (1st Ave – 8th Ave, Yesler – Stewart)
- All cameras validated to lie within SUMO network bounds (`seattlecity.net.xml`)
- Coordinates: WGS-84 lat/lon → SUMO x/y via `sumolib` + pyproj (UTM Zone 10N)
- Each camera mapped to SUMO lane IDs per direction (UP/DOWN/LEFT/RIGHT)

---

## 13. Key Design Decisions

| Decision | Rationale |
|---|---|
| MPC + MaxPressure hybrid | MPC optimal under predictable demand; MaxPressure throughput-stable under incidents/noise |
| SafetyWrapper as outermost layer | Physical constraints must never be violated regardless of algorithm |
| Redis as feature cache (not DB) | Sub-millisecond reads; 30 s TTL forces freshness |
| MongoDB change streams for ingest | Zero-polling; microsecond latency from insert to decision |
| MAXBAND vs greedy offsets | Simultaneous bi-directional progression; MILP finds global optimum |
| Outcome worker at T+45 s | Queue dynamics stabilise within ~30–60 s; 45 s is a balanced window |
| Holt DES over simple EWMA | Captures linear trend (growing/decaying demand); warm-starts from 2nd observation |
| Operator override in Redis | TTL-based expiry; survives worker restart; checked at ~100 ms latency |

---

## 14. Benchmark Results Summary

Tested across 4 demand profiles × 5 controller modes.

**Key finding:** On a coordinated green-wave network (fixed-time plans already optimised for this corridor), the AI agents provide **marginal mean-throughput improvement** — fixed-time wins on average metrics.

**Where the hybrid agent adds value:**
- `bursty` demand profile: `max_wait` reduced by ~19% vs MaxPressure, ~15% vs fixed_time
- Worst-case wait time (P95) reduced across all demand profiles
- Incidents (non-uniform arrivals) trigger MaxPressure automatically, maintaining stability

**Conclusion:** AlpenMesh's value case is **worst-case wait reduction and incident robustness**, not mean throughput on a pre-optimised arterial.

---

*Generated from source: `MasterAgent/` codebase — April 2026*
