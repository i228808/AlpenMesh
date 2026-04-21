"""
observability/metrics.py — Prometheus metrics for the MasterAgent decision pipeline.
"""
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST


decision_latency = Histogram(
    "master_decision_latency_seconds",
    "End-to-end decision latency",
    labelnames=["stage"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1.0),
)

mode_selected = Counter(
    "master_mode_selected_total",
    "Decision mode selected",
    labelnames=["mode"],
)

solver_fallback = Counter(
    "master_solver_fallback_total",
    "Solver failures triggering Max-Pressure fallback",
)

unmapped_roi = Counter(
    "master_unmapped_roi_total",
    "ROI names that could not be mapped to canonical locations",
    labelnames=["camera_name"],
)

queue_estimate = Gauge(
    "master_queue_estimate",
    "Estimated queue length",
    labelnames=["intersection", "approach"],
)

incident_active = Gauge(
    "master_incident_active",
    "Currently active incidents",
    labelnames=["intersection", "kind"],
)

forecast_mape = Gauge(
    "master_forecast_mape",
    "Forecast MAPE over last 15 min",
    labelnames=["roi", "model"],
)

ingest_lag_seconds = Histogram(
    "master_ingest_lag_seconds",
    "Lag from metric timestamp to ingest time",
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0),
)
