"""
coordination/maxband.py — MAXBAND-style corridor offset optimization.

Computes common-cycle offsets for a corridor of intersections to maximize
green-band width in both directions, given live travel times.

Uses PuLP with CBC solver (free, MIT-licensed).
"""
from __future__ import annotations
import os
from typing import Dict, List, Optional, Tuple

try:
    import pulp
    HAS_PULP = True
except ImportError:
    HAS_PULP = False


def solve_maxband(
    intersections: List[str],
    travel_times: List[float],
    green_ratios: List[float],
    cycle_length: float = 90.0,
    min_band: float = 5.0,
) -> Optional[Dict[str, float]]:
    """
    Solve MAXBAND for a single corridor.

    Args:
        intersections: ordered list of intersection IDs along corridor
        travel_times: travel time between consecutive pairs (len = n-1)
        green_ratios: green fraction g_i/C for each intersection
        cycle_length: common cycle length C (seconds)
        min_band: minimum band width to consider feasible (seconds)

    Returns:
        Dict of intersection_id → offset_seconds, or None if infeasible.
    """
    if not HAS_PULP:
        return None

    n = len(intersections)
    if n < 2 or len(travel_times) != n - 1 or len(green_ratios) != n:
        return None

    prob = pulp.LpProblem("maxband", pulp.LpMaximize)

    # Variables
    b = pulp.LpVariable("bandwidth", lowBound=0)  # band width (fraction of C)
    theta = [pulp.LpVariable(f"theta_{i}", lowBound=0, upBound=1) for i in range(n)]
    # Integer variables for wrapping
    m_fwd = [pulp.LpVariable(f"mf_{i}", cat="Integer") for i in range(n - 1)]
    m_bwd = [pulp.LpVariable(f"mb_{i}", cat="Integer") for i in range(n - 1)]

    # Objective: maximize bandwidth
    prob += b

    # Constraints for each link
    for i in range(n - 1):
        t_ij = travel_times[i] / cycle_length  # normalized travel time
        g_i = green_ratios[i]
        g_j = green_ratios[i + 1]

        # Forward band constraint
        prob += theta[i + 1] - theta[i] - t_ij + m_fwd[i] >= b / 2 - (1 - g_j) / 2
        prob += theta[i + 1] - theta[i] - t_ij + m_fwd[i] <= (1 - g_i) / 2 - b / 2

        # Backward band constraint
        prob += theta[i] - theta[i + 1] - t_ij + m_bwd[i] >= b / 2 - (1 - g_i) / 2
        prob += theta[i] - theta[i + 1] - t_ij + m_bwd[i] <= (1 - g_j) / 2 - b / 2

    # Fix first offset to 0 (reference)
    prob += theta[0] == 0

    # Bandwidth bounds
    prob += b >= min_band / cycle_length
    prob += b <= min(green_ratios)

    try:
        prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=5))
    except Exception:
        return None

    if prob.status != pulp.constants.LpStatusOptimal:
        return None

    offsets = {}
    for i, name in enumerate(intersections):
        offsets[name] = round(theta[i].varValue * cycle_length, 1)

    return offsets


def webster_cycle(flows: List[float], sat_flows: List[float],
                  lost_time: float = 12.0) -> float:
    """Webster's optimal cycle length formula."""
    if not flows or not sat_flows or len(flows) != len(sat_flows):
        return 90.0
    y_sum = sum(f / s for f, s in zip(flows, sat_flows) if s > 0)
    if y_sum >= 1.0:
        return 120.0  # oversaturated — cap
    c_opt = (1.5 * lost_time + 5) / (1 - y_sum)
    return max(60.0, min(c_opt, 180.0))
