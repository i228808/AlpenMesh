//! Scheduler liveness watchdog.
//!
//! Periodically scans `state.nodes` and reclaims cameras pinned to workers
//! that stopped heartbeating. Without this loop, a worker that crashes or gets
//! network-partitioned would leave its assigned cameras pinned forever — the
//! only other release path (`stream-status`) requires the dead worker itself
//! to call it.

use crate::state::{NodeStatus, SchedulerState};
use chrono::{Duration as ChronoDuration, Utc};
use std::thread;
use std::time::Duration;
use tracing::{info, warn};

/// How long since `last_seen` before a node is considered dead.
const NODE_TIMEOUT_SECS: i64 = 30;
/// How often the watchdog scans `state.nodes`.
const SCAN_INTERVAL_SECS: u64 = 10;
/// How long a released camera waits before being eligible for reassignment.
/// Short enough that recovery is quick, long enough to avoid thrashing between
/// a flapping worker and its replacement.
const RELEASE_RETRY_AFTER_SECS: i64 = 10;

pub fn start_liveness_task(state: SchedulerState) {
    thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for liveness watchdog");

        rt.block_on(async move {
            info!(
                "Liveness watchdog started (node timeout={}s, scan={}s)",
                NODE_TIMEOUT_SECS, SCAN_INTERVAL_SECS
            );
            loop {
                tokio::time::sleep(Duration::from_secs(SCAN_INTERVAL_SECS)).await;
                run_scan(&state);
            }
        });
    });
}

fn run_scan(state: &SchedulerState) {
    let now = Utc::now();
    let timeout = ChronoDuration::seconds(NODE_TIMEOUT_SECS);
    let retry_after_deadline = now + ChronoDuration::seconds(RELEASE_RETRY_AFTER_SECS);

    // 1. Collect the set of node IDs that just transitioned to offline this scan.
    // We only want to release cameras for nodes *newly* going offline to avoid
    // repeatedly re-releasing on every scan for the same dead node.
    let newly_offline: Vec<String> = {
        let mut nodes = match state.nodes.write() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let mut newly_offline = Vec::new();
        for (id, node) in nodes.iter_mut() {
            let stale = (now - node.last_seen) > timeout;
            match (stale, &node.status) {
                (true, NodeStatus::Online) => {
                    node.status = NodeStatus::Offline;
                    newly_offline.push(id.clone());
                }
                (false, NodeStatus::Offline) => {
                    node.status = NodeStatus::Online;
                    info!(worker_id = %id, "Node recovered; marked Online");
                }
                _ => {}
            }
        }
        newly_offline
    };

    if newly_offline.is_empty() {
        return;
    }

    for worker_id in &newly_offline {
        warn!(
            worker_id = %worker_id,
            "Node missed heartbeat for >{}s; releasing its cameras",
            NODE_TIMEOUT_SECS
        );
    }

    // 2. Free any camera pinned to a now-offline worker and push a short
    // retry-after cooldown so it can be reassigned on the next healthy
    // heartbeat without thrashing if the old worker comes back immediately.
    let offline: std::collections::HashSet<&str> =
        newly_offline.iter().map(|s| s.as_str()).collect();
    let mut released = Vec::new();
    {
        let mut cameras = match state.cameras.write() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        for (cam_id, camera) in cameras.iter_mut() {
            if let Some(assigned) = camera.assigned_to.as_deref() {
                if offline.contains(assigned) {
                    camera.assigned_to = None;
                    released.push(cam_id.clone());
                }
            }
        }
    }

    if !released.is_empty() {
        let mut retry = match state.stream_retry_after.write() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        for cam_id in &released {
            retry.insert(cam_id.clone(), retry_after_deadline);
        }
        info!(
            released = released.len(),
            "Released cameras from offline workers: {:?}", released
        );
    }
}
