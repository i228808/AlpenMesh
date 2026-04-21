import pandas as pd
import matplotlib.pyplot as plt
import os
import sys

def plot_comparison(results_dir: str, seed: int = 42, demand: str = "medium"):
    hybrid_file = os.path.join(results_dir, f"{seed}_{demand}_hybrid.csv")
    rule_based_file = os.path.join(results_dir, f"{seed}_{demand}_rule_based.csv")

    if not os.path.exists(hybrid_file):
        print(f"Error: {hybrid_file} not found.")
        sys.exit(1)
    if not os.path.exists(rule_based_file):
        print(f"Error: {rule_based_file} not found.")
        sys.exit(1)

    df_hybrid = pd.read_csv(hybrid_file)
    df_rule = pd.read_csv(rule_based_file)

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle(f'SUMO MasterAgent Comparison (Demand: {demand})', fontsize=16)

    # 1. Total Queue
    axes[0, 0].plot(df_rule['sim_time'], df_rule['total_queue'], label='Rule-Based', alpha=0.8)
    axes[0, 0].plot(df_hybrid['sim_time'], df_hybrid['total_queue'], label='Hybrid (MPC+MaxPressure)', alpha=0.8)
    axes[0, 0].set_title('Total Vehicles in Queue')
    axes[0, 0].set_xlabel('Simulation Time (s)')
    axes[0, 0].set_ylabel('Queue Length')
    axes[0, 0].legend()
    axes[0, 0].grid(True)

    # 2. Average Wait Time
    axes[0, 1].plot(df_rule['sim_time'], df_rule['avg_wait_time'], label='Rule-Based', alpha=0.8)
    axes[0, 1].plot(df_hybrid['sim_time'], df_hybrid['avg_wait_time'], label='Hybrid (MPC+MaxPressure)', alpha=0.8)
    axes[0, 1].set_title('Average Wait Time per Vehicle')
    axes[0, 1].set_xlabel('Simulation Time (s)')
    axes[0, 1].set_ylabel('Wait Time (s)')
    axes[0, 1].legend()
    axes[0, 1].grid(True)

    # 3. Max Wait Time (Equity)
    axes[1, 0].plot(df_rule['sim_time'], df_rule['max_wait_time'], label='Rule-Based', alpha=0.8)
    axes[1, 0].plot(df_hybrid['sim_time'], df_hybrid['max_wait_time'], label='Hybrid (MPC+MaxPressure)', alpha=0.8)
    axes[1, 0].axhline(y=90, color='r', linestyle='--', label='90s Max Wait Guard')
    axes[1, 0].set_title('Max Wait Time (Equity)')
    axes[1, 0].set_xlabel('Simulation Time (s)')
    axes[1, 0].set_ylabel('Max Wait Time (s)')
    axes[1, 0].legend()
    axes[1, 0].grid(True)

    # 4. Throughput
    axes[1, 1].plot(df_rule['sim_time'], df_rule['throughput'], label='Rule-Based', alpha=0.8)
    axes[1, 1].plot(df_hybrid['sim_time'], df_hybrid['throughput'], label='Hybrid (MPC+MaxPressure)', alpha=0.8)
    axes[1, 1].set_title('Cumulative Throughput (Vehicles Arrived)')
    axes[1, 1].set_xlabel('Simulation Time (s)')
    axes[1, 1].set_ylabel('Total Arrived')
    axes[1, 1].legend()
    axes[1, 1].grid(True)

    plt.tight_layout()
    output_path = os.path.join(results_dir, f"{seed}_{demand}_comparison.png")
    plt.savefig(output_path)
    print(f"\nSaved comparison chart to: {output_path}")

    # Print summary stats
    print("\n--- PERFORMANCE SUMMARY ---")
    print(f"{'Metric':<25} | {'Rule-Based':<12} | {'Hybrid (MPC)':<12} | {'Improvement'}")
    print("-" * 65)

    def print_stat(name, rule_val, hybrid_val, is_lower_better=True):
        diff = hybrid_val - rule_val
        pct = (diff / rule_val * 100) if rule_val > 0 else 0
        if is_lower_better:
            trend = "better" if diff < 0 else "worse"
        else:
            trend = "better" if diff > 0 else "worse"
        print(f"{name:<25} | {rule_val:<12.1f} | {hybrid_val:<12.1f} | {pct:+.1f}% ({trend})")

    print_stat("Avg Wait Time (end)", df_rule['avg_wait_time'].iloc[-1], df_hybrid['avg_wait_time'].iloc[-1])
    print_stat("Max Wait Time (peak)", df_rule['max_wait_time'].max(), df_hybrid['max_wait_time'].max())
    print_stat("Total Queue (peak)", df_rule['total_queue'].max(), df_hybrid['total_queue'].max())
    print_stat("Throughput (total)", df_rule['throughput'].iloc[-1], df_hybrid['throughput'].iloc[-1], is_lower_better=False)

if __name__ == "__main__":
    results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
    plot_comparison(results_dir)
