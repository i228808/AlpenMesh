"""
agents/mpc.py — Model Predictive Control per-intersection signal controller.

Uses cvxpy with CBC/ECOS to solve a receding-horizon QP/MILP at each
decision cycle. Falls back to Max-Pressure on solver failure.

Horizon: 6 steps × 5s = 30s
Budget:  150ms p99 solve time
"""
from __future__ import annotations
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from .base import MasterAgentBase

try:
    import cvxpy as cp
    HAS_CVXPY = True
except ImportError:
    HAS_CVXPY = False

HORIZON         = int(os.getenv("MPC_HORIZON_STEPS",  "6"))
STEP_S          = float(os.getenv("MPC_STEP_S",       "5"))
SAT_FLOW        = float(os.getenv("MPC_SAT_FLOW",     "0.5"))  # veh/s/lane
SWITCH_PENALTY  = float(os.getenv("MPC_SWITCH_PENALTY", "2.0"))
# Extra cost for switching *away from the currently-served approach*
# (represents lost throughput during yellow + all-red clearance).
# Clearance cost = YELLOW_S(3) + ALL_RED_S(2) = 5s × SAT_FLOW(0.5 veh/s) = 2.5 veh-equiv.
# A ×1.6 safety margin gives ~4.0. The old default of 25.0 was 10× too high and made
# MPC return "hold current" almost every cycle, collapsing it to MaxPressure behaviour.
CURRENT_SWITCH_PENALTY = float(os.getenv("MPC_CURRENT_SWITCH_PENALTY", "4.0"))
EQUITY_WEIGHT   = float(os.getenv("MPC_EQUITY_WEIGHT",  "1.5"))
SOLVE_TIMEOUT   = float(os.getenv("MPC_SOLVE_TIMEOUT",  "0.15"))  # seconds

# Minimum commitment window — below this, MPC always re-selects current approach.
# Matches MaxPressure's MIN_COMMIT_S for a consistent hybrid cycle floor.
MIN_COMMIT_S    = float(os.getenv("MPC_MIN_COMMIT_S",  "6"))

# Consecutive failures before demotion to Max-Pressure
MAX_CONSECUTIVE_FAILURES = 2
DEMOTION_DURATION_S = 60.0


class MpcAgent(MasterAgentBase):
    """
    Receding-horizon MPC for intersection signal control.

    State per approach a:
      q[t+1,a] = q[t,a] + arrival_forecast[t,a] - sat_flow * g[t, phase(a)] * step_s

    Cost:
      Σ_t Σ_a q[t,a]² + λ * switches + μ * max_a(wait[a])
    """

    def __init__(self):
        self._consecutive_failures: Dict[str, int] = {}
        self._demoted_until: Dict[str, float] = {}

    def is_demoted(self, intersection_id: str) -> bool:
        until = self._demoted_until.get(intersection_id, 0)
        if time.time() < until:
            return True
        if until > 0:
            self._demoted_until.pop(intersection_id, None)
            self._consecutive_failures.pop(intersection_id, None)
        return False

    def decide(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        if not HAS_CVXPY:
            return self._fail(metrics, "cvxpy not installed")

        intersection_id = metrics.get("camera_name", "unknown")

        if self.is_demoted(intersection_id):
            return self._fail(metrics, f"Demoted to Max-Pressure until {self._demoted_until[intersection_id]:.0f}")

        vehicle_counts: Dict[str, int] = metrics.get("vehicle_counts", {}) or {}
        traffic_metrics: Dict[str, Dict] = metrics.get("traffic_metrics", {}) or {}
        forecasts: Dict[str, List[float]] = metrics.get("arrival_forecasts", {}) or {}

        # Build approach list and initial queues
        approaches = sorted(set(vehicle_counts.keys()) | set(traffic_metrics.keys()))
        if len(approaches) < 2:
            return self._fail(metrics, f"Need >=2 approaches, got {len(approaches)}")

        n_approaches = len(approaches)
        q0 = np.array([
            float(traffic_metrics.get(a, {}).get("occupancy", vehicle_counts.get(a, 0)))
            for a in approaches
        ])

        # Current-phase awareness: SafetyWrapper injects the approach we are
        # actively serving and how long we've been on it. Without this, MPC
        # treats switching as free at t=0 and oscillates.
        current_approach: Optional[str] = metrics.get("_current_approach")
        phase_elapsed: float = float(metrics.get("_phase_elapsed", 0.0) or 0.0)
        current_idx: Optional[int] = (approaches.index(current_approach)
                                      if current_approach in approaches else None)

        # Minimum commitment: below MIN_COMMIT_S, short-circuit to "keep current"
        # without running the solver. Saves solver cost and prevents pointless churn
        # (SafetyWrapper would block any switch anyway inside MIN_GREEN_S).
        if current_idx is not None and phase_elapsed < MIN_COMMIT_S:
            self._consecutive_failures.pop(intersection_id, None)
            return {
                "action":     "PRIORITIZE",
                "target_roi": current_approach,
                "reason":     (f"MPC: hold {current_approach} "
                               f"(min commit {phase_elapsed:.0f}/{MIN_COMMIT_S:.0f}s)"),
                "mode":       "mpc",
                "queue_initial": {a: float(q0[i]) for i, a in enumerate(approaches)},
                "current_approach": current_approach,
                "phase_elapsed": round(phase_elapsed, 1),
            }

        # Arrival forecast: prefer caller-provided multi-step series
        # (from HoltPredictor/Ensemble). Fallbacks are used only when no
        # forecast is supplied at all — in which case we assume a saturation-
        # capped constant background so a just-drained lane still attracts
        # arrivals.
        arrivals = np.zeros((HORIZON, n_approaches))
        for i, a in enumerate(approaches):
            series = forecasts.get(a)
            if series:
                # Use provided list, right-padding with the last value if it
                # is shorter than HORIZON. Accept scalar as degenerate case.
                if isinstance(series, (int, float)):
                    arrivals[:, i] = float(series)
                else:
                    vals = [float(v) for v in series[:HORIZON]]
                    if len(vals) < HORIZON:
                        pad = vals[-1] if vals else 0.5
                        vals = vals + [pad] * (HORIZON - len(vals))
                    arrivals[:, i] = vals
            else:
                baseline = 0.2 * q0[i]
                background = 0.5  # veh per step, i.e. 0.1 veh/s — light steady flow
                arrivals[:, i] = max(baseline, background)

        # Corridor platoon injection. The hybrid orchestrator can pass a
        # per-approach spike schedule of the form {approach: [(step, veh)]}
        # — e.g. "5 vehicles expected to arrive 2 steps from now on the
        # UP approach". We add the spike onto the base arrival forecast
        # so the MPC solver anticipates the platoon.
        platoon_injection = metrics.get("_platoon_injection") or {}
        if platoon_injection:
            for a, spikes in platoon_injection.items():
                if a not in approaches:
                    continue
                idx = approaches.index(a)
                for step, veh in spikes:
                    step_i = int(step)
                    if 0 <= step_i < HORIZON:
                        arrivals[step_i, idx] += max(0.0, float(veh))

        try:
            result = self._solve(q0, arrivals, n_approaches, approaches, current_idx)
        except Exception as e:
            self._record_failure(intersection_id)
            return self._fail(metrics, f"Solver error: {e}")

        if result is None:
            self._record_failure(intersection_id)
            return self._fail(metrics, "Solver returned infeasible/timeout")

        self._consecutive_failures.pop(intersection_id, None)

        best_approach_idx, solve_time = result
        best_approach = approaches[best_approach_idx]

        return {
            "action": "PRIORITIZE",
            "target_roi": best_approach,
            "reason": (f"MPC: optimal phase for {best_approach} "
                       f"(solve {solve_time*1000:.0f}ms, H={HORIZON}x{STEP_S}s)"),
            "mode": "mpc",
            "solve_time_ms": round(solve_time * 1000, 1),
            "queue_initial": {a: float(q0[i]) for i, a in enumerate(approaches)},
            "current_approach": current_approach,
            "phase_elapsed": round(phase_elapsed, 1),
        }

    def _solve(self, q0: np.ndarray, arrivals: np.ndarray,
               n_approaches: int, approaches: List[str],
               current_idx: Optional[int] = None,
               ) -> Optional[Tuple[int, float]]:
        """Solve the MPC QP. Returns (best_first_step_phase_idx, solve_time) or None.

        If ``current_idx`` is provided, the first-step decision is biased toward
        keeping that approach green (penalty on deviation from one-hot e_current
        at t=0). This encodes the real-world clearance cost that the rest of the
        horizon does not see.
        """
        H = HORIZON
        n = n_approaches

        # Decision: green fraction per (time_step, approach) — relaxed continuous
        g = cp.Variable((H, n), nonneg=True)

        # Queue state
        q = cp.Variable((H + 1, n), nonneg=True)

        constraints = [q[0] == q0]

        for t in range(H):
            # Queue dynamics
            constraints.append(
                q[t + 1] == q[t] + arrivals[t] - SAT_FLOW * STEP_S * g[t]
            )
            # One-phase-at-a-time: green fractions sum to <= 1
            constraints.append(cp.sum(g[t]) <= 1.0)
            # Each green fraction <= 1
            constraints.append(g[t] <= 1.0)

        # Cost: queue^2 (equity) + switch penalty
        queue_cost = cp.sum(cp.square(q[1:]))

        # Horizon switch penalty: penalize changes between consecutive steps
        switch_cost = 0.0
        if H > 1:
            switch_cost = SWITCH_PENALTY * cp.sum(cp.abs(g[1:] - g[:-1]))

        # Current-phase switch penalty: represent the clearance throughput
        # loss if t=0 deviates from the currently-served approach.
        current_switch_cost = 0.0
        if current_idx is not None:
            e_current = np.zeros(n)
            e_current[current_idx] = 1.0
            current_switch_cost = CURRENT_SWITCH_PENALTY * cp.sum(cp.abs(g[0] - e_current))

        # Equity: penalize maximum queue across approaches at final step
        equity_cost = EQUITY_WEIGHT * cp.max(q[H])

        objective = cp.Minimize(queue_cost + switch_cost
                                + current_switch_cost + equity_cost)

        prob = cp.Problem(objective, constraints)

        t0 = time.time()
        try:
            prob.solve(solver=cp.ECOS, max_iters=200, verbose=False)
        except cp.SolverError:
            prob.solve(solver=cp.SCS, max_iters=500, verbose=False)
        solve_time = time.time() - t0

        if prob.status not in ("optimal", "optimal_inaccurate") or g.value is None:
            return None

        # Extract first-step decision: approach with highest green fraction
        first_step_greens = g.value[0]
        best_idx = int(np.argmax(first_step_greens))
        return (best_idx, solve_time)

    def _record_failure(self, intersection_id: str) -> None:
        count = self._consecutive_failures.get(intersection_id, 0) + 1
        self._consecutive_failures[intersection_id] = count
        if count >= MAX_CONSECUTIVE_FAILURES:
            self._demoted_until[intersection_id] = time.time() + DEMOTION_DURATION_S

    def _fail(self, metrics: Dict[str, Any], reason: str) -> Dict[str, Any]:
        return {
            "action": "FALLBACK",
            "target_roi": None,
            "reason": f"MPC fallback: {reason}",
            "mode": "mpc_fallback",
        }
