"""
observability/debug_log.py — Single rotating JSONL debug log used by the
agent chain (safety, mode_selector, MPC, MaxPressure, corridor, sumo_runner).

Replaces the per-module hand-rolled ``_dbg()`` helpers that all wrote to
the same fixed ``debug-c90683.log`` file with no rotation. Enforces:

* Process-wide singleton handler (avoids duplicate writes when multiple
  modules configure logging independently).
* Size-based rotation (default 8 MiB × 3 back-ups) so disk usage is
  bounded for long-running SUMO benchmarks.
* ``DEBUG_LOG_ENABLED`` env flag — when ``"0"`` the logger becomes a
  no-op so production runs don't pay the I/O cost.

Usage::

    from observability.debug_log import dbg
    dbg("agents/safety.py:decide", "guard_MIN_GREEN", {"intersection": iid})

Each call emits one JSON line with: sessionId, timestamp, location,
message, data.
"""
from __future__ import annotations
import json
import logging
import os
import threading
import time
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Optional


_DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "debug-c90683.log",
)
_DEFAULT_MAX_BYTES = 8 * 1024 * 1024   # 8 MiB
_DEFAULT_BACKUP    = 3

_session_id: str = os.environ.get("DEBUG_SESSION_ID", "c90683")
_enabled: bool   = os.environ.get("DEBUG_LOG_ENABLED", "1") != "0"
_logger: Optional[logging.Logger] = None
_lock = threading.Lock()


def _build_logger() -> logging.Logger:
    """Create (or return cached) singleton logger."""
    global _logger
    if _logger is not None:
        return _logger
    with _lock:
        if _logger is not None:
            return _logger
        path = os.environ.get("DEBUG_LOG_PATH", _DEFAULT_PATH)
        max_bytes = int(os.environ.get("DEBUG_LOG_MAX_BYTES", _DEFAULT_MAX_BYTES))
        backup = int(os.environ.get("DEBUG_LOG_BACKUP_COUNT", _DEFAULT_BACKUP))
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            handler = RotatingFileHandler(path, maxBytes=max_bytes,
                                          backupCount=backup, encoding="utf-8")
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger = logging.getLogger("alpenmesh.debug")
            logger.setLevel(logging.DEBUG)
            logger.propagate = False
            # Drop any previous handlers to avoid duplicate writes if a
            # caller re-configures logging (pytest, IPython, etc.)
            for h in list(logger.handlers):
                logger.removeHandler(h)
            logger.addHandler(handler)
            _logger = logger
        except Exception:
            # Degrade gracefully: if we can't open the file, install a
            # NullHandler so downstream callers don't crash.
            logger = logging.getLogger("alpenmesh.debug")
            logger.addHandler(logging.NullHandler())
            logger.propagate = False
            _logger = logger
        return _logger


def dbg(location: str, message: str, data: Optional[Dict[str, Any]] = None) -> None:
    """Emit a JSONL debug record. No-op if DEBUG_LOG_ENABLED=0."""
    if not _enabled:
        return
    try:
        payload = {
            "sessionId": _session_id,
            "location":  location,
            "message":   message,
            "data":      data or {},
            "timestamp": int(time.time() * 1000),
        }
        _build_logger().debug(json.dumps(payload, default=str))
    except Exception:
        # Debug logging must never take the process down.
        pass


def set_enabled(flag: bool) -> None:
    """Runtime toggle — primarily used by tests."""
    global _enabled
    _enabled = bool(flag)


__all__ = ["dbg", "set_enabled"]
