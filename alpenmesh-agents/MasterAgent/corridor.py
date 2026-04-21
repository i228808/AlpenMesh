"""
corridor.py — Corridor detection, platoon event management, and downstream propagation.

The CorridorManager is loaded from corridor_config.yaml at startup.
It maintains a list of in-flight PlatoonEvents and exposes two hooks
called by master_agent.py:

    on_platoon_released(camera_name, direction, queue_size)
        → fires when a large queue clears after a green switch

    get_platoon_boost(camera_name, direction) → float
        → returns a demand-score additive for a camera about to receive
          vehicles from an upstream platoon

The green-wave travel time estimate uses euclidean distance between
camera SUMO coordinates and a configurable average speed (default 30 mph
≈ 13.4 m/s).
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import yaml


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class CameraNode:
    """Lightweight representation of a camera within a corridor."""
    name: str
    sumo_x: float
    sumo_y: float
    axis: str          # "EW" or "NS"

    def distance_to(self, other: "CameraNode") -> float:
        """Euclidean distance in SUMO coordinate units (metres)."""
        return math.sqrt((self.sumo_x - other.sumo_x) ** 2 +
                         (self.sumo_y - other.sumo_y) ** 2)


@dataclass
class Corridor:
    """An ordered sequence of cameras along a shared street."""
    name: str
    axis: str                          # which street axis these cameras observe
    cameras: List[CameraNode]          # ordered upstream → downstream
    avg_block_distance_m: float = 0.0  # populated by CorridorManager after load

    def downstream_of(self, camera_name: str) -> Optional[CameraNode]:
        """Return the next camera downstream from camera_name, or None."""
        for i, cam in enumerate(self.cameras):
            if cam.name == camera_name and i + 1 < len(self.cameras):
                return self.cameras[i + 1]
        return None

    def upstream_of(self, camera_name: str) -> Optional[CameraNode]:
        """Return the next camera upstream from camera_name, or None."""
        for i, cam in enumerate(self.cameras):
            if cam.name == camera_name and i - 1 >= 0:
                return self.cameras[i - 1]
        return None


@dataclass
class PlatoonEvent:
    """A platoon released by an upstream camera, propagating downstream."""
    origin_camera: str
    destination_camera: str
    direction: str          # UP or DOWN
    queue_size: int         # number of vehicles in the released queue
    eta: float              # unix timestamp when platoon expected to arrive
    created_at: float = field(default_factory=time.time)
    consumed: bool = False

    @property
    def boost_magnitude(self) -> float:
        """
        Demand-score boost contributed by this event.
        Scales with queue_size, capped at 2.0.
        """
        return min(self.queue_size / 10.0, 2.0)

    def is_active(self, now: float, lead_window_s: float = 4.0,
                  tail_window_s: float = 12.0) -> bool:
        """
        True if the platoon is expected to have arrived (within windows).
        The boost is applied from (eta - lead_window_s) to (eta + tail_window_s).
        """
        return (self.eta - lead_window_s) <= now <= (self.eta + tail_window_s)

    def is_expired(self, now: float, tail_window_s: float = 12.0) -> bool:
        return now > (self.eta + tail_window_s)


# ---------------------------------------------------------------------------
# CorridorManager
# ---------------------------------------------------------------------------

class CorridorManager:
    """
    Manages corridor topology and in-flight platoon events.

    Lifecycle:
        mgr = CorridorManager.from_yaml("corridor_config.yaml",
                                        "camera_config.yaml")
        # Called by master_agent during every decide() cycle:
        mgr.on_platoon_released("3rd Ave & Spring St", "UP", queue_size=8)
        boost = mgr.get_platoon_boost("3rd Ave & Seneca St", "UP")
    """

    # Vehicles travel at this speed between intersections (m/s).
    AVG_SPEED_MS: float = 13.4   # ≈ 30 mph

    # Minimum queue release that triggers a platoon event.
    MIN_PLATOON_QUEUE: int = 4

    def __init__(self):
        self._corridors: Dict[str, Corridor] = {}
        # camera_name → list of corridors it belongs to
        self._camera_index: Dict[str, List[Corridor]] = {}
        # All in-flight platoon events
        self._events: List[PlatoonEvent] = []
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_yaml(cls,
                  corridor_yaml: str = "corridor_config.yaml",
                  camera_yaml: str = "camera_config.yaml") -> "CorridorManager":
        """
        Build a CorridorManager from the generated YAML config files.
        Returns an empty (no-op) manager if either file is missing.
        """
        mgr = cls()
        try:
            with open(camera_yaml) as f:
                cam_cfg = yaml.safe_load(f)
            with open(corridor_yaml) as f:
                cor_cfg = yaml.safe_load(f)
        except FileNotFoundError as e:
            import logging
            logging.getLogger(__name__).warning(
                "CorridorManager: config file missing (%s) — running without corridor propagation", e
            )
            return mgr

        # Build CameraNode lookup from camera_config.yaml
        cam_nodes: Dict[str, CameraNode] = {}
        for cam_name, cam_data in (cam_cfg.get("cameras") or {}).items():
            cam_nodes[cam_name] = CameraNode(
                name=cam_name,
                sumo_x=float(cam_data.get("sumo_x", 0)),
                sumo_y=float(cam_data.get("sumo_y", 0)),
                axis=cam_data.get("axis", "NS"),
            )

        # Build Corridor objects
        for corridor_name, cor_data in (cor_cfg.get("corridors") or {}).items():
            ordered_names = cor_data.get("cameras_ordered", [])
            nodes = []
            for name in ordered_names:
                if name in cam_nodes:
                    nodes.append(cam_nodes[name])

            if not nodes:
                continue

            corridor = Corridor(
                name=corridor_name,
                axis=cor_data.get("axis", "NS"),
                cameras=nodes,
            )

            # Compute avg block distance from consecutive pairs
            if len(nodes) >= 2:
                dists = [nodes[i].distance_to(nodes[i + 1])
                         for i in range(len(nodes) - 1)]
                corridor.avg_block_distance_m = sum(dists) / len(dists)

            mgr._corridors[corridor_name] = corridor

            # Index cameras → their corridors
            for node in nodes:
                mgr._camera_index.setdefault(node.name, []).append(corridor)

        return mgr

    # ------------------------------------------------------------------
    # Public hooks (called from master_agent.decide())
    # ------------------------------------------------------------------

    def on_platoon_released(self,
                            camera_name: str,
                            direction: str,
                            queue_size: int) -> None:
        """
        Called when a large queue clears immediately after a green phase
        is granted to the observed axis.

        Fires PlatoonEvent(s) at the next downstream camera in every
        corridor that `camera_name` belongs to, provided the camera
        is observing traffic moving in `direction`.

        Args:
            camera_name: The camera that released the platoon.
            direction:   "UP" or "DOWN" (which way vehicles are moving).
            queue_size:  Vehicles that departed (used to size the boost).
        """
        if queue_size < self.MIN_PLATOON_QUEUE:
            return

        direction = direction.upper()
        now = time.time()

        with self._lock:
            corridors = self._camera_index.get(camera_name, [])
            for corridor in corridors:
                downstream = corridor.downstream_of(camera_name)
                if downstream is None:
                    continue

                # Estimate travel time based on euclidean distance
                origin_node = next(
                    (c for c in corridor.cameras if c.name == camera_name), None
                )
                if origin_node is None:
                    continue

                dist_m = origin_node.distance_to(downstream)
                travel_time_s = dist_m / self.AVG_SPEED_MS

                event = PlatoonEvent(
                    origin_camera=camera_name,
                    destination_camera=downstream.name,
                    direction=direction,
                    queue_size=queue_size,
                    eta=now + travel_time_s,
                )
                self._events.append(event)

            # Purge fully expired events to prevent unbounded list growth
            self._events = [e for e in self._events if not e.is_expired(now)]

    def get_platoon_boost(self, camera_name: str, direction: str) -> float:
        """
        Returns the total demand-score boost from any active PlatoonEvents
        targeted at (camera_name, direction).

        Multiple simultaneous platoons (e.g., from two upstream corridors)
        are summed, then capped at 3.0.

        Args:
            camera_name: The camera requesting a boost.
            direction:   "UP" or "DOWN".

        Returns:
            Additive boost value (float ≥ 0).
        """
        direction = direction.upper()
        now = time.time()
        total_boost = 0.0

        with self._lock:
            for event in self._events:
                if (event.destination_camera == camera_name and
                        event.direction == direction and
                        event.is_active(now) and
                        not event.consumed):
                    total_boost += event.boost_magnitude

            # Purge expired events
            self._events = [e for e in self._events if not e.is_expired(now)]

        return min(total_boost, 3.0)

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def active_events(self) -> List[dict]:
        """Return a JSON-serialisable snapshot of active platoon events."""
        now = time.time()
        with self._lock:
            return [
                {
                    "origin": e.origin_camera,
                    "destination": e.destination_camera,
                    "direction": e.direction,
                    "queue_size": e.queue_size,
                    "eta_in_s": round(e.eta - now, 1),
                    "boost": e.boost_magnitude,
                }
                for e in self._events
                if e.is_active(now) and not e.consumed
            ]

    def corridor_summary(self) -> dict:
        """Return human-readable summary of loaded corridors."""
        return {
            name: {
                "axis": c.axis,
                "cameras": [n.name for n in c.cameras],
                "avg_block_m": round(c.avg_block_distance_m, 1),
            }
            for name, c in self._corridors.items()
        }

    @property
    def n_corridors(self) -> int:
        return len(self._corridors)

    @property
    def n_active_events(self) -> int:
        now = time.time()
        with self._lock:
            return sum(1 for e in self._events if e.is_active(now) and not e.consumed)
