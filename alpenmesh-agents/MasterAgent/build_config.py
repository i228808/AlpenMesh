"""
build_config.py — One-shot config generator for the corridor advisory system.

Reads:
    cameras.json          (from the edge scheduler — 12 camera entries)
    camera_mapping.json   (SUMO coordinates + lane maps)

Produces:
    camera_config.yaml    (per-camera axis, coordinates, pairing info)
    corridor_config.yaml  (auto-detected corridors by street name + proximity)

Run once (or re-run after adding cameras):
    python build_config.py
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import yaml


# ---------------------------------------------------------------------------
# Paths (resolved relative to this script's directory)
# ---------------------------------------------------------------------------

BASE = os.path.dirname(os.path.abspath(__file__))
EDGE_SCHEDULER_DIR = os.path.join(
    BASE, "..", "EdgeAgent", "alpenmesh-edge-scheduler"
)

CAMERAS_JSON    = os.path.join(EDGE_SCHEDULER_DIR, "cameras.json")
MAPPING_JSON    = os.path.join(BASE, "camera_mapping.json")
CAMERA_YAML_OUT = os.path.join(BASE, "camera_config.yaml")
CORRIDOR_OUT    = os.path.join(BASE, "corridor_config.yaml")

# Corridor proximity threshold — two cameras on the same street must be
# within this many SUMO units (≈ metres) to be grouped.
PROXIMITY_THRESHOLD_M = 700.0

# Minimum platoon queue to trigger a corridor event.
MIN_PLATOON_QUEUE = 4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_axis_from_url(url: str) -> Optional[str]:
    """
    Extract EW / NS axis from the filename suffix in a camera URL.
    e.g. '…/3_Seneca_EW.jpg' → 'EW', '…/3_University_NS.jpg' → 'NS'
    Returns None if no suffix found.
    """
    match = re.search(r"_(EW|NS)(?:\.\w+)?(?:\.stream)?$", url, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


def _parse_axis_from_stream(stream_url: str) -> Optional[str]:
    """Same but for the streamUrl field."""
    match = re.search(r"_(EW|NS)\.stream", stream_url, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


def _heading_to_axis(heading: int) -> str:
    """
    Map a compass heading to the axis the camera observes.
    heading == 0   → camera faces North or South → observes NS traffic
    heading == 90  → camera faces East or West   → observes EW traffic
    """
    return "EW" if (heading is not None and abs(heading % 180) == 90) else "NS"


def _normalize(name: str) -> str:
    """
    Normalise a camera/mapping key to a canonical token sequence for matching.

    camera_mapping.json uses keys like '3rd_Ave__Spring_St'
    cameras.json uses names  like '3rd Ave & Spring St'

    Both should map to the same token string: '3rd ave spring st'
    Strategy: lowercase, replace any non-alphanumeric with a space,
    collapse runs of spaces, strip.
    """
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def _euclidean(x1, y1, x2, y2) -> float:
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)


def _parse_street_name(camera_name: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract the two street names from a camera label like '3rd Ave & Seneca St'.
    Returns (street_A, street_B) or (None, None) on parse failure.
    """
    parts = re.split(r"\s*&\s*", camera_name, maxsplit=1)
    if len(parts) == 2:
        # Strip trailing axis suffixes from the second part
        b = re.sub(r"\s+(EW|NS)$", "", parts[1].strip(), flags=re.IGNORECASE)
        return parts[0].strip(), b
    return None, None


# ---------------------------------------------------------------------------
# Main build logic
# ---------------------------------------------------------------------------

def build_camera_config(cameras: list, mapping: dict) -> dict:
    """
    Merge cameras.json + camera_mapping.json into a per-camera config dict.
    """
    cfg: Dict[str, dict] = {}

    # Build a normalised lookup for the mapping keys
    mapping_norm = {_normalize(k): k for k in mapping}

    # Debug: print a few normalised keys so mismatches are obvious
    print("\n  Mapping normalised keys sample:")
    for k in list(mapping_norm.keys())[:3]:
        print(f"    {k!r}")

    for cam in cameras:
        name: str = cam["cameraName"]
        norm = _normalize(name)

        # Resolve SUMO coordinates from camera_mapping.json
        mapping_key = mapping_norm.get(norm)
        sumo_data = mapping.get(mapping_key, {}) if mapping_key else {}
        sumo_x: float = sumo_data.get("sumo_x", 0.0)
        sumo_y: float = sumo_data.get("sumo_y", 0.0)

        if sumo_x == 0.0 and sumo_y == 0.0:
            print(f"  [WARN] No SUMO coords for {name!r} (norm={norm!r}, key={mapping_key!r})")

        # Determine axis
        url         = cam.get("url", "")
        stream_url  = cam.get("streamUrl", "")
        heading     = cam.get("heading", 0)

        axis = (
            _parse_axis_from_url(url)
            or _parse_axis_from_stream(stream_url)
        )
        needs_check = False
        if axis is None:
            # Fallback: infer from heading
            axis = _heading_to_axis(heading)
            needs_check = True  # flag for manual verification

        # Detect paired cameras (same physical location, different axis)
        paired_with: Optional[str] = None

        entry: Dict = {
            "sumo_x":             sumo_x,
            "sumo_y":             sumo_y,
            "lat":                cam.get("latitude"),
            "lon":                cam.get("longitude"),
            "axis":               axis,
            "stream_url":         stream_url,
            "image_url":          url,
            "image_id":           cam.get("imageId"),
            "heading":            heading,
            "needs_manual_check": needs_check,
            "paired_with":        paired_with,
        }
        cfg[name] = entry

    # Second pass: detect pairs at the same physical location
    # Only pair cameras that actually have SUMO coordinates (sumo_x != 0)
    names = list(cfg.keys())
    for i, n1 in enumerate(names):
        for n2 in names[i + 1:]:
            x1, y1 = cfg[n1]["sumo_x"], cfg[n1]["sumo_y"]
            x2, y2 = cfg[n2]["sumo_x"], cfg[n2]["sumo_y"]
            # Skip cameras without resolved coords
            if x1 == 0.0 and y1 == 0.0:
                continue
            if x2 == 0.0 and y2 == 0.0:
                continue
            d = _euclidean(x1, y1, x2, y2)
            if d < 5.0 and cfg[n1]["axis"] != cfg[n2]["axis"]:
                cfg[n1]["paired_with"] = n2
                cfg[n2]["paired_with"] = n1

    return cfg



def build_corridor_config(camera_cfg: dict) -> dict:
    """
    Auto-detect corridors by grouping cameras that share a street name
    and lie within PROXIMITY_THRESHOLD_M of each other.

    Returns a corridors dict keyed by corridor name.
    """

    # Collect all cameras with their street names
    cam_streets: Dict[str, List[str]] = {}  # camera_name → [street_A, street_B]
    for name in camera_cfg:
        clean = re.sub(r"\s+(EW|NS)$", "", name, flags=re.IGNORECASE)
        a, b = _parse_street_name(clean)
        if a and b:
            cam_streets[name] = [a, b]

    # Group cameras by street name
    street_cameras: Dict[str, List[str]] = defaultdict(list)
    for cam_name, streets in cam_streets.items():
        for st in streets:
            street_cameras[st].append(cam_name)

    corridors: Dict[str, dict] = {}

    for street, cams in street_cameras.items():
        if len(cams) < 2:
            continue  # single camera on this street → not a corridor

        # Filter to cameras within PROXIMITY_THRESHOLD_M of each other
        # (Use pairwise check: keep cameras that have at least one neighbour)
        valid = []
        for c in cams:
            has_neighbour = any(
                _euclidean(
                    camera_cfg[c]["sumo_x"], camera_cfg[c]["sumo_y"],
                    camera_cfg[other]["sumo_x"], camera_cfg[other]["sumo_y"],
                ) < PROXIMITY_THRESHOLD_M
                for other in cams if other != c
            )
            if has_neighbour:
                valid.append(c)

        if len(valid) < 2:
            continue

        # Determine primary axis this street's cameras observe
        # A camera on "3rd Ave" observes the NS axis of traffic along 3rd Ave
        # (i.e., the street it's named after is the one flowing through frame)
        axes = [camera_cfg[c]["axis"] for c in valid]
        primary_axis = max(set(axes), key=axes.count)

        # Sort cameras along the corridor (ascending sumo_y = south-to-north)
        sort_key = "sumo_y" if primary_axis == "NS" else "sumo_x"
        ordered = sorted(valid, key=lambda c: camera_cfg[c][sort_key])

        # Compute average block distance between consecutive cameras
        dists = []
        for i in range(len(ordered) - 1):
            d = _euclidean(
                camera_cfg[ordered[i]]["sumo_x"], camera_cfg[ordered[i]]["sumo_y"],
                camera_cfg[ordered[i+1]]["sumo_x"], camera_cfg[ordered[i+1]]["sumo_y"],
            )
            dists.append(d)
        avg_dist = sum(dists) / len(dists) if dists else 0.0

        # Build a safe corridor key from the street name
        corridor_key = re.sub(r"[^a-zA-Z0-9]", "_", street).strip("_")

        corridors[corridor_key] = {
            "street_name":          street,
            "axis":                 primary_axis,
            "cameras_ordered":      ordered,
            "avg_block_distance_m": round(avg_dist, 1),
        }

    return {"corridors": corridors}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    # Load source files
    print(f"Loading cameras from: {CAMERAS_JSON}")
    if not os.path.exists(CAMERAS_JSON):
        sys.exit(f"ERROR: cameras.json not found at {CAMERAS_JSON}")

    with open(CAMERAS_JSON) as f:
        cameras: list = json.load(f)

    print(f"Loading mapping from: {MAPPING_JSON}")
    if not os.path.exists(MAPPING_JSON):
        sys.exit(f"ERROR: camera_mapping.json not found at {MAPPING_JSON}")

    with open(MAPPING_JSON) as f:
        mapping: dict = json.load(f)

    print(f"\nLoaded {len(cameras)} cameras, {len(mapping)} mapping entries.")

    # Build camera config
    camera_cfg = build_camera_config(cameras, mapping)

    # Report needs_manual_check flags
    flagged = [n for n, d in camera_cfg.items() if d.get("needs_manual_check")]
    if flagged:
        print(f"\n[WARN] {len(flagged)} camera(s) have no EW/NS suffix - axis inferred from heading:")
        for name in flagged:
            axis = camera_cfg[name]["axis"]
            print(f"   {name!r:40s}  assumed axis={axis}  (PLEASE VERIFY)")

    # Write camera_config.yaml
    with open(CAMERA_YAML_OUT, "w", encoding="utf-8") as f:
        yaml.dump({"cameras": camera_cfg}, f,
                  default_flow_style=False, allow_unicode=True, sort_keys=True)
    print(f"\n[OK] Wrote {CAMERA_YAML_OUT}")

    # Build corridor config
    corridor_cfg = build_corridor_config(camera_cfg)

    # Report detected corridors
    print(f"\n[OK] Detected {len(corridor_cfg['corridors'])} corridor(s):")
    for name, data in corridor_cfg["corridors"].items():
        cams = data["cameras_ordered"]
        print(f"  [{name}]  axis={data['axis']}  cameras={len(cams)}  "
              f"avg_block={data['avg_block_distance_m']:.0f}m")
        for c in cams:
            print(f"      - {c}")

    # Write corridor_config.yaml
    with open(CORRIDOR_OUT, "w", encoding="utf-8") as f:
        yaml.dump(corridor_cfg, f,
                  default_flow_style=False, allow_unicode=True, sort_keys=False)
    print(f"\n[OK] Wrote {CORRIDOR_OUT}")
    print("\nDone. Review any [WARN] flags above, then run master_agent.py.")


if __name__ == "__main__":
    main()
