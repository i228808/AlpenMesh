"""Benchmark matrix for FYP panel.

Runs fixed_time vs maxpressure vs hybrid across balanced + asymmetric demand,
then emits a summary table (results/panel_summary.csv) and a comparison chart
(results/panel_chart.png).
"""
from __future__ import annotations
import csv
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE = Path(__file__).resolve().parent
RESULTS = BASE / "results"
RESULTS.mkdir(exist_ok=True)

PYTHON = BASE / ".venv" / "Scripts" / "python.exe"

DURATION = int(os.getenv("BENCH_DURATION_S", "600"))
SEED     = int(os.getenv("BENCH_SEED", "42"))
MODES    = ["fixed_time", "maxpressure", "hybrid"]
PROFILES = ["balanced", "asymmetric", "peak", "bursty"]
# Skip the first WARMUP_S seconds when computing summary metrics.
# Adaptive controllers need warm-up time (Holt DES, MPC queue build-up);
# measuring from t=0 biases the comparison toward fixed-time.
WARMUP_S = float(os.getenv("BENCH_WARMUP_S", "60"))

NOISE_FILTER = {"findRoute", "Invalid departure", "not allowed on destination",
                "Step #", "No connection", "emergency braking",
                "Teleporting", "ends teleporting", "jam,"}


def _run(mode: str, profile: str) -> dict:
    """Run one simulation and return aggregate stats from its CSV."""
    env = os.environ.copy()
    env.update({
        "SYNTHETIC_METRICS": "1",
        "SYNTHETIC_DEMAND":  "1",
        "HEADLESS":          "1",
        "SIM_DURATION_S":    str(DURATION),
        "RANDOM_SEED":       str(SEED),
        "DEMAND_LEVEL":      profile,  # used as CSV tag
        "CONTROLLER_MODE":   mode,
        "DEMAND_PROFILE":    profile,
    })

    csv_path = RESULTS / f"{SEED}_{profile}_{mode}.csv"
    csv_path.unlink(missing_ok=True)

    t0 = time.time()
    proc = subprocess.Popen(
        [str(PYTHON), "sumo_runner.py"],
        cwd=str(BASE), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if proc.stdout is not None:
        for line in proc.stdout:
            if not any(p in line for p in NOISE_FILTER):
                sys.stdout.write(f"  [{profile}/{mode}] {line}")
    proc.wait()
    dt = time.time() - t0

    if not csv_path.exists():
        return {"mode": mode, "profile": profile, "wall_s": round(dt, 1), "error": "no csv"}

    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return {"mode": mode, "profile": profile, "wall_s": round(dt, 1), "error": "empty csv"}

    def col(name, src=None):
        return [float(r.get(name, 0) or 0) for r in (src if src is not None else rows)]

    # Post-warmup rows for adaptive-sensitive metrics (avg/max wait, queue).
    # Using all rows biases against adaptive controllers that drain vehicles
    # faster in the early phase, leaving a higher-wait residual backlog.
    warm_rows = [r for r in rows if float(r.get("sim_time", 0)) >= WARMUP_S] or rows

    avg_wait  = sum(col("avg_wait_time", warm_rows))  / len(warm_rows)
    max_wait  = max(col("max_wait_time"))
    avg_queue = sum(col("total_queue",   warm_rows))  / len(warm_rows)
    max_queue = max(col("total_queue"))
    avg_veh   = sum(col("total_vehicles", warm_rows)) / len(warm_rows)
    thru      = int(float(rows[-1].get("throughput", 0) or 0))
    switches  = int(sum(col("phase_switches_this_step")))
    avg_dep_delay = sum(col("avg_dep_delay", warm_rows)) / len(warm_rows)
    mpc_decisions = int(sum(col("mpc_decisions")))

    return {
        "mode":          mode,
        "profile":       profile,
        "wall_s":        round(dt, 1),
        "rows":          len(rows),
        "warm_rows":     len(warm_rows),
        "avg_veh":       round(avg_veh,       1),
        "avg_wait":      round(avg_wait,       2),
        "avg_dep_delay": round(avg_dep_delay,  2),
        "max_wait":      round(max_wait,       1),
        "avg_queue":     round(avg_queue,      2),
        "max_queue":     round(max_queue,      1),
        "thruput":       thru,
        "switches":      switches,
        "mpc_decisions": mpc_decisions,
    }


def main() -> int:
    combos = [(profile, mode) for profile in PROFILES for mode in MODES]
    n = len(combos)
    print(f"Panel benchmark | duration={DURATION}s seed={SEED} warmup={WARMUP_S}s")
    print(f"Modes: {MODES}  Profiles: {PROFILES}")
    print(f"Running {n} simulations in parallel ...")
    print()

    # Each _run() call spawns its own SUMO subprocess, so ThreadPoolExecutor
    # gives true parallelism (no GIL contention — work is in child processes).
    results_map: dict = {}
    with ThreadPoolExecutor(max_workers=n) as pool:
        futures = {pool.submit(_run, mode, profile): (profile, mode)
                   for profile, mode in combos}
        for fut in as_completed(futures):
            profile, mode = futures[fut]
            try:
                r = fut.result()
            except Exception as exc:
                r = {"mode": mode, "profile": profile, "error": str(exc)}
            results_map[(profile, mode)] = r
            if "error" in r:
                print(f"  [{profile:10s}/{mode:12s}] ERROR ({r['error']})")
            else:
                print(f"  [{profile:10s}/{mode:12s}] "
                      f"wait={r['avg_wait']:5.2f} dep_delay={r['avg_dep_delay']:5.2f} "
                      f"maxw={r['max_wait']:5.1f} q={r['avg_queue']:5.1f} "
                      f"thru={r['thruput']:3d} mpc={r.get('mpc_decisions',0)} ({r['wall_s']:.0f}s)", flush=True)

    # Restore deterministic row order (profile order, then mode order)
    results = [results_map[(p, m)] for p, m in combos if (p, m) in results_map]

    summary_path = RESULTS / "panel_summary.csv"
    keys = ["profile", "mode", "rows", "warm_rows", "avg_veh", "avg_wait", "avg_dep_delay",
            "max_wait", "avg_queue", "max_queue", "thruput", "switches", "mpc_decisions", "wall_s"]
    with open(summary_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for r in results:
            if "error" not in r:
                w.writerow({k: r.get(k) for k in keys})
    print(f"\nWrote {summary_path}")

    print()
    print(f"{'profile':<12}{'mode':<14}{'avg_wait':>10}{'dep_delay':>11}{'max_wait':>10}{'avg_queue':>11}{'thruput':>10}{'switches':>10}{'mpc_dec':>10}")
    print("-" * 98)
    for r in results:
        if "error" in r:
            print(f"{r['profile']:<12}{r['mode']:<14} ERROR: {r['error']}")
            continue
        print(f"{r['profile']:<12}{r['mode']:<14}"
              f"{r['avg_wait']:>10.2f}{r['avg_dep_delay']:>11.2f}{r['max_wait']:>10.1f}"
              f"{r['avg_queue']:>11.2f}{r['thruput']:>10d}{r['switches']:>10d}{r.get('mpc_decisions',0):>10d}")

    print()
    for profile in PROFILES:
        ft = next((x for x in results if x["profile"] == profile and x["mode"] == "fixed_time" and "error" not in x), None)
        hy = next((x for x in results if x["profile"] == profile and x["mode"] == "hybrid" and "error" not in x), None)
        if ft and hy:
            def pct(name, lower_is_better=True):
                a, b = ft[name], hy[name]
                if a == 0:
                    return "n/a"
                delta = (b - a) / a * 100
                if lower_is_better:
                    arrow = "better" if delta < 0 else "worse"
                else:
                    arrow = "better" if delta > 0 else "worse"
                return f"{delta:+.1f}% ({arrow})"
            print(f"[{profile}] hybrid vs fixed_time  "
                  f"avg_wait {pct('avg_wait')},  "
                  f"dep_delay {pct('avg_dep_delay')},  "
                  f"max_wait {pct('max_wait')},  "
                  f"avg_queue {pct('avg_queue')},  "
                  f"thruput {pct('thruput', lower_is_better=False)}")

    try:
        _make_chart(results)
    except Exception as e:
        print(f"chart skipped: {e}")

    return 0


def _make_chart(results):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import csv as _csv

    metrics = [("avg_wait", "Average Wait Time (s)"),
               ("max_wait", "Peak Wait Time (s)"),
               ("avg_queue", "Average Queue Length (veh)"),
               ("thruput",  "Total Throughput (veh)")]

    fig, axes = plt.subplots(2, 2, figsize=(14, 9))
    axes = axes.flatten()
    colors = {"fixed_time": "#d62728", "maxpressure": "#ff7f0e", "hybrid": "#2ca02c"}

    for ax, (key, title) in zip(axes, metrics):
        x = range(len(PROFILES))
        width = 0.25
        for i, mode in enumerate(MODES):
            vals = [next((r.get(key, 0) for r in results
                          if r["profile"] == p and r["mode"] == mode and "error" not in r), 0)
                    for p in PROFILES]
            ax.bar([xi + (i - 1) * width for xi in x], vals, width,
                   label=mode, color=colors.get(mode, "gray"))
        ax.set_xticks(list(x))
        ax.set_xticklabels(PROFILES)
        ax.set_title(title, fontsize=12)
        ax.legend(loc="best")
        ax.grid(True, axis="y", alpha=0.3)

    fig.suptitle(f"Master Agent Benchmark ({DURATION}s, seed={SEED})",
                 fontsize=14, fontweight="bold")
    fig.tight_layout()

    chart_path = RESULTS / "panel_chart.png"
    fig.savefig(chart_path, dpi=120)
    print(f"Wrote {chart_path}")

    # Hero charts: time-series per mode for bursty (best case for adaptive)
    # and asymmetric profiles side by side.
    hero_profiles = [p for p in ["bursty", "asymmetric"] if p in PROFILES]
    if hero_profiles:
        fig2, axes2 = plt.subplots(1, len(hero_profiles), figsize=(12 * len(hero_profiles), 5),
                                    squeeze=False)
        for col, profile in enumerate(hero_profiles):
            ax2 = axes2[0][col]
            for mode in MODES:
                csv_path = RESULTS / f"{SEED}_{profile}_{mode}.csv"
                if not csv_path.exists():
                    continue
                rows2 = list(_csv.DictReader(open(csv_path)))
                if not rows2:
                    continue
                xs = [float(r["sim_time"]) for r in rows2]
                ys = [float(r["avg_wait_time"]) for r in rows2]
                ax2.plot(xs, ys, label=mode, linewidth=2, color=colors.get(mode, "gray"))
            ax2.set_xlabel("Simulation time (s)")
            ax2.set_ylabel("Average wait time (s)")
            ax2.set_title(f"{profile.title()} Demand: Wait-Time (lower = better)",
                          fontsize=12, fontweight="bold")
            ax2.legend(loc="best")
            ax2.grid(True, alpha=0.3)
        fig2.suptitle(f"Adaptive vs Fixed-Time ({DURATION}s, seed={SEED})",
                      fontsize=13, fontweight="bold")
        fig2.tight_layout()
        ts_path = RESULTS / "panel_timeseries.png"
        fig2.savefig(ts_path, dpi=120)
        print(f"Wrote {ts_path}")


if __name__ == "__main__":
    sys.exit(main())
