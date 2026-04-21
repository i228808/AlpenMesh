"""
roi_adapter.py — Map free-form EdgeAgent ROI names to canonical
(intersection_id, approach, movement) tuples.

Resolution tiers (first match wins):
  1. Explicit table from roi_mapping.yaml (per-camera overrides)
  2. NB/SB/EB/WB_<movement> regex (standard compass naming)
  3. Camera-perspective names from road_rois.json:
       down  = traffic toward camera  → S through
       up    = traffic away           → N through
       left  = left from camera POV   → W through
       right = right from camera POV  → E through
       bus   = bus lane (toward cam)  → S through
       intersection / int             → None (zone ROI, not an approach)
"""
from __future__ import annotations
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import yaml


@dataclass(frozen=True)
class RoiLocation:
    """Canonical traffic location."""
    intersection_id: str   # e.g. "3rd_Ave__Seneca_St"
    approach: str          # N, S, E, W
    movement: str          # through, left, right


# Regex for standard EdgeAgent ROI names: "NB_through", "SB_left", etc.
_ROI_RE = re.compile(
    r"^(?P<approach>NB|SB|EB|WB)_(?P<movement>through|left|right)$",
    re.IGNORECASE,
)

_APPROACH_MAP = {"NB": "N", "SB": "S", "EB": "E", "WB": "W"}

# Camera-perspective ROI names used in road_rois.json.
# "down" = traffic moving toward the camera (southbound by convention).
# "up"   = traffic moving away from the camera (northbound by convention).
_PERSPECTIVE_MAP: Dict[str, Tuple[str, str]] = {
    "UP":    ("N", "through"),
    "DOWN":  ("S", "through"),
    "LEFT":  ("W", "through"),
    "RIGHT": ("E", "through"),
    "BUS":   ("S", "through"),
}

# Zone ROIs that cover the intersection box, not an approach lane — skip them.
_ZONE_ROIS = {"INTERSECTION", "INT"}


class RoiMapper:
    """
    Four-tier ROI resolution:
      1. Explicit table from roi_mapping.yaml
      2. Regex-based inference from NB/SB/EB/WB prefix
      3. Camera-perspective names (down/up/left/right/bus)
      4. Zone ROIs (intersection/int) → None
    """

    def __init__(self, mapping_yaml: Optional[str] = None):
        self._explicit: Dict[Tuple[str, str], RoiLocation] = {}
        if mapping_yaml and os.path.exists(mapping_yaml):
            self._load_yaml(mapping_yaml)

    def _load_yaml(self, path: str) -> None:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        for intersection_id, rois in data.get("mappings", {}).items():
            for roi_name, loc in (rois or {}).items():
                key = (intersection_id, roi_name.upper())
                self._explicit[key] = RoiLocation(
                    intersection_id=intersection_id,
                    approach=loc["approach"],
                    movement=loc.get("movement", "through"),
                )

    def resolve(self, camera_name: str, roi_name: str) -> Optional[RoiLocation]:
        """Resolve a (camera_name, roi_name) pair to a RoiLocation."""
        intersection_id = self._camera_to_intersection(camera_name)

        # 1. Explicit table
        key = (intersection_id, roi_name.upper())
        if key in self._explicit:
            return self._explicit[key]

        # 2. Regex inference
        m = _ROI_RE.match(roi_name)
        if m:
            approach = _APPROACH_MAP[m.group("approach").upper()]
            movement = m.group("movement").lower()
            return RoiLocation(intersection_id, approach, movement)

        # 3. Camera-perspective names and zone ROIs
        upper = roi_name.upper()
        if upper in _ZONE_ROIS:
            return None  # intersection-box zone, not an approach lane
        if upper in _PERSPECTIVE_MAP:
            approach, movement = _PERSPECTIVE_MAP[upper]
            return RoiLocation(intersection_id, approach, movement)

        return None

    def resolve_all(self, camera_name: str,
                    roi_dict: Dict[str, object]) -> List[Tuple[RoiLocation, object]]:
        """Resolve all ROIs in a dict, returning (location, value) pairs.
        Unmapped ROIs are silently skipped (caller should count them)."""
        results = []
        for roi_name, value in roi_dict.items():
            loc = self.resolve(camera_name, roi_name)
            if loc is not None:
                results.append((loc, value))
        return results

    @staticmethod
    def _camera_to_intersection(camera_name: str) -> str:
        """Normalize camera name to intersection_id format.
        'nw_mercer_and_fairview_ave_n' → as-is (scheduler normalized).
        '3rd Ave & Seneca St' → '3rd_Ave__Seneca_St' (camera_config.yaml format).
        """
        return camera_name.replace(" & ", "__").replace(" ", "_")
